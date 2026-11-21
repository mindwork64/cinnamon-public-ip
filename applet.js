/*
 * Public IP Cinnamon applet
 * Public IP: https://l2.io/ip.json
 * Country:   https://ipwho.is/<ip>
 */

const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const Mainloop = imports.mainloop;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const UUID = "public-ip-cinnamon@mindwork64";
const IP_URL = "https://l2.io/ip.json";
const COUNTRY_URL = "https://ipwho.is/";
const REQUEST_TIMEOUT = 8;
const FALLBACK_INTERVAL_SECONDS = 30;
const MIN_REFRESH_GAP_SECONDS = 3;

let NM = null;
let nmAvailable = false;

try {
    NM = imports.gi.NM;
    nmAvailable = true;
} catch (e) {
    global.logWarning(UUID + ": NetworkManager GI unavailable; using timer fallback: " + e);
}

class PublicIPApplet extends Applet.TextApplet {
    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);
        this.set_applet_label("…");
        this.set_applet_tooltip("Получение публичного IP…");

        this._ip = null;
        this._country = null;
        this._countryCode = null;
        this._busy = false;
        this._removed = false;
        this._refreshAgain = false;
        this._lastRefresh = 0;
        this._lastNetworkSignature = null;
        this._timerId = 0;
        this._debounceId = 0;
        this._nmClient = null;
        this._nmSignals = [];
        this._deviceSignals = [];

        this._menu = new Applet.AppletPopupMenu(this, orientation);
        this._statusItem = new PopupMenu.PopupMenuItem("Проверка ещё не выполнялась", { reactive: false });
        this._refreshItem = new PopupMenu.PopupMenuItem("Обновить сейчас");
        this._refreshItem.connect("activate", () => this._requestRefresh(true));
        this._menu.addMenuItem(this._statusItem);
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._menu.addMenuItem(this._refreshItem);
        this._menuManager = new PopupMenu.PopupMenuManager(this);
        this._menuManager.addMenu(this._menu);

        this._startNetworkMonitoring();
        this._requestRefresh(true);

        // Safety net and fallback for VPN implementations not reported by NM.
        this._timerId = Mainloop.timeout_add_seconds(FALLBACK_INTERVAL_SECONDS, () => {
            this._checkNetworkSignature();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _startNetworkMonitoring() {
        if (!nmAvailable)
            return;
        try {
            this._nmClient = NM.Client.new(null);
            if (!this._nmClient)
                throw new Error("NM.Client.new returned null");

            this._nmSignals.push([this._nmClient,
                this._nmClient.connect("device-added", () => this._networkChanged("Добавлено сетевое устройство"))]);
            this._nmSignals.push([this._nmClient,
                this._nmClient.connect("device-removed", () => this._networkChanged("Удалено сетевое устройство"))]);
            this._nmSignals.push([this._nmClient,
                this._nmClient.connect("notify::active-connections", () => this._networkChanged("Изменились активные подключения"))]);

            this._attachDeviceSignals();
            this._nmSignals.push([this._nmClient,
                this._nmClient.connect("notify::devices", () => {
                    this._attachDeviceSignals();
                    this._networkChanged("Изменился список интерфейсов");
                })]);
        } catch (e) {
            global.logWarning(UUID + ": NetworkManager monitoring failed; timer fallback enabled: " + e);
            this._disconnectSignals(this._nmSignals);
            this._disconnectSignals(this._deviceSignals);
            this._nmClient = null;
        }
    }

    _attachDeviceSignals() {
        if (!this._nmClient)
            return;
        this._disconnectSignals(this._deviceSignals);
        try {
            let devices = this._nmClient.get_devices();
            for (let i = 0; i < devices.length; i++) {
                let device = devices[i];
                let id = device.connect("state-changed", () => this._networkChanged("Состояние интерфейса изменилось"));
                this._deviceSignals.push([device, id]);
            }
        } catch (e) {
            global.logWarning(UUID + ": Could not attach device state listeners: " + e);
        }
    }

    _disconnectSignals(items) {
        for (let i = 0; i < items.length; i++) {
            try {
                if (items[i][0] && items[i][0].handler_is_connected(items[i][1]))
                    items[i][0].disconnect(items[i][1]);
            } catch (e) {
                // Object may already have been destroyed by NetworkManager.
            }
        }
        items.length = 0;
    }

    _networkChanged(reason) {
        if (this._removed)
            return;
        this._statusItem.label.text = reason + " — перепроверка IP…";
        if (this._debounceId)
            Mainloop.source_remove(this._debounceId);
        this._debounceId = Mainloop.timeout_add_seconds(2, () => {
            this._debounceId = 0;
            this._requestRefresh(false);
            return GLib.SOURCE_REMOVE;
        });
    }

    _getNetworkSignature() {
        try {
            let file = Gio.File.new_for_path("/sys/class/net");
            let enumerator = file.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null);
            let names = [];
            let info;
            while ((info = enumerator.next_file(null)) !== null)
                names.push(info.get_name());
            enumerator.close(null);
            names.sort();

            let states = [];
            for (let i = 0; i < names.length; i++) {
                let stateFile = Gio.File.new_for_path("/sys/class/net/" + names[i] + "/operstate");
                try {
                    let [ok, bytes] = GLib.file_get_contents(stateFile.get_path());
                    states.push(names[i] + ":" + bytes.toString().trim());
                } catch (e) {
                    states.push(names[i] + ":?");
                }
            }
            return states.join("|");
        } catch (e) {
            global.logWarning(UUID + ": Interface scan failed: " + e);
            return null;
        }
    }

    _checkNetworkSignature() {
        let signature = this._getNetworkSignature();
        if (signature === null)
            return;
        if (this._lastNetworkSignature === null) {
            this._lastNetworkSignature = signature;
            return;
        }
        if (signature !== this._lastNetworkSignature) {
            this._lastNetworkSignature = signature;
            this._networkChanged("Обнаружено изменение сетевых интерфейсов");
        }
    }

    _runCurl(url, callback) {
        let proc;
        try {
            proc = Gio.Subprocess.new(
                ["curl", "--fail", "--silent", "--show-error", "--location",
                 "--max-time", String(REQUEST_TIMEOUT), "--user-agent",
                 "Public-IP-Cinnamon/1.0", url],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
        } catch (e) {
            callback(null, "Не удалось запустить curl: " + e);
            return;
        }
        proc.communicate_utf8_async(null, null, (source, result) => {
            try {
                let [ok, stdout, stderr] = source.communicate_utf8_finish(result);
                if (!ok || source.get_exit_status() !== 0) {
                    callback(null, (stderr || "HTTP-запрос завершился с ошибкой").trim());
                    return;
                }
                callback(stdout, null);
            } catch (e) {
                callback(null, String(e));
            }
        });
    }

    _requestRefresh(force) {
        if (this._removed)
            return;
        let now = GLib.get_monotonic_time() / 1000000;
        if (!force && now - this._lastRefresh < MIN_REFRESH_GAP_SECONDS)
            return;
        if (this._busy) {
            this._refreshAgain = true;
            return;
        }
        this._busy = true;
        this._lastRefresh = now;
        this._statusItem.label.text = "Получение публичного IP…";

        this._runCurl(IP_URL, (body, error) => {
            if (this._removed)
                return;
            if (error) {
                this._finishWithError("Ошибка получения IP: " + error);
                return;
            }
            let data;
            try {
                data = JSON.parse(body);
            } catch (e) {
                this._finishWithError("l2.io вернул некорректный JSON");
                return;
            }
            let ip = data && typeof data.ip === "string" ? data.ip.trim() : "";
            if (!ip || !/^[0-9a-fA-F:.]+$/.test(ip)) {
                this._finishWithError("В ответе l2.io отсутствует корректный IP");
                return;
            }
            this._lookupCountry(ip);
        });
    }

    _lookupCountry(ip) {
        this._runCurl(COUNTRY_URL + encodeURIComponent(ip), (body, error) => {
            if (this._removed)
                return;
            if (error) {
                this._ip = ip;
                this._country = null;
                this._countryCode = null;
                this._busy = false;
                this._render();
                this._statusItem.label.text = "Страна не определена: " + error;
                this._runQueuedRefresh();
                return;
            }
            try {
                let data = JSON.parse(body);
                if (data.success === false)
                    throw new Error(data.message || "Сервис геолокации отклонил запрос");
                this._ip = ip;
                this._country = data.country || null;
                this._countryCode = data.country_code || null;
                this._busy = false;
                this._render();
                this._statusItem.label.text = this._country
                    ? "Страна: " + this._country + (this._countryCode ? " (" + this._countryCode + ")" : "")
                    : "Страна не определена";
                this._runQueuedRefresh();
            } catch (e) {
                this._ip = ip;
                this._country = null;
                this._countryCode = null;
                this._busy = false;
                this._render();
                this._statusItem.label.text = "IP получен, но страну разобрать не удалось";
                this._runQueuedRefresh();
            }
        });
    }

    _finishWithError(message) {
        this._busy = false;
        this.set_applet_label("IP: —");
        this.set_applet_tooltip(message);
        this._statusItem.label.text = message;
        this._runQueuedRefresh();
    }

    _runQueuedRefresh() {
        if (this._refreshAgain && !this._removed) {
            this._refreshAgain = false;
            Mainloop.timeout_add_seconds(1, () => {
                this._requestRefresh(true);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _flagEmoji(code) {
        if (!code || !/^[A-Za-z]{2}$/.test(code))
            return "";
        let upper = code.toUpperCase();
        return String.fromCodePoint(
            0x1F1E6 + upper.charCodeAt(0) - 65,
            0x1F1E6 + upper.charCodeAt(1) - 65
        );
    }

    _render() {
        if (!this._ip) {
            this.set_applet_label("IP: —");
            this.set_applet_tooltip("Публичный IP пока не получен");
            return;
        }
        let flag = this._flagEmoji(this._countryCode);
        this.set_applet_label((flag ? flag + " " : "") + this._ip);
        let tooltip = "Публичный IP: " + this._ip;
        if (this._country)
            tooltip += "\nСтрана: " + this._country;
        if (this._countryCode)
            tooltip += "\nКод страны: " + this._countryCode;
        tooltip += "\nИсточник IP: l2.io";
        this.set_applet_tooltip(tooltip);
    }

    on_applet_clicked(event) {
        this._menu.toggle();
    }

    on_applet_removed_from_panel() {
        this._removed = true;
        if (this._timerId)
            Mainloop.source_remove(this._timerId);
        if (this._debounceId)
            Mainloop.source_remove(this._debounceId);
        this._disconnectSignals(this._nmSignals);
        this._disconnectSignals(this._deviceSignals);
        if (this._menu)
            this._menu.destroy();
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new PublicIPApplet(metadata, orientation, panelHeight, instanceId);
}

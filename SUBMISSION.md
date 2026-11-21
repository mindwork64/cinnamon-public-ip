# Cinnamon Spices submission notes

This repository contains the applet source and a builder for the official Cinnamon Spices layout.

## Build the submission directory

```bash
./build-spices.sh
```

The generated directory is `dist/public-ip-cinnamon@mindwork64/`. It contains `info.json`, `screenshot.png`, `README.md`, and the installable payload under `files/public-ip-cinnamon@mindwork64/`. The `files/` directory contains only the UUID directory, as required by Cinnamon Spices.

## Validate against the official repository

Clone `https://github.com/linuxmint/cinnamon-spices-applets`, copy the generated UUID directory into that checkout, then run:

```bash
./validate-spice public-ip-cinnamon@mindwork64
```

## Pull request

Submit only this applet directory to `linuxmint/cinnamon-spices-applets`. The contribution guidelines require one applet per PR and a title in the form `spice name: short description`. Suggested title: `Public IP: add public IP and country indicator`.

The pull request must be opened by the GitHub account named in `info.json` (`mindwork64`) so that the contribution is attributed to the applet author. This repository is prepared for submission; it does not submit or publish the PR by itself.

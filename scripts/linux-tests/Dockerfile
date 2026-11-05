# A Linux environment for the extension's tests: Java, Node, the libraries VS Code needs to run under Xvfb, and the
# Saxon-HE 12 and 13 distributions (whose jars find their dependencies, e.g. xmlresolver, in their lib folder).
# Used by scripts/linux-tests/run.sh.
FROM node:24-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
        openjdk-17-jdk-headless xvfb xauth rsync unzip \
        libnss3 libatk1.0-0 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2 libxss1 libsecret-1-0 libxkbfile1 \
    && rm -rf /var/lib/apt/lists/*

RUN for v in 12-9 13-1; do \
        curl -sfL -o /tmp/saxon.zip "https://github.com/Saxonica/Saxon-HE/releases/download/SaxonHE$v/SaxonHE${v}J.zip" \
        && unzip -q /tmp/saxon.zip -d "/opt/SaxonHE${v}J" && rm /tmp/saxon.zip; \
    done

# VS Code (Electron) won't run as root without --no-sandbox
USER node
# the mount points for run.sh's volumes, so new volumes are owned by node too
RUN mkdir -p /home/node/work/node_modules /home/node/work/.vscode-test
WORKDIR /home/node/work

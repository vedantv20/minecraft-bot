FROM ghcr.io/puppeteer/puppeteer:24.6.1

ENV NODE_ENV=production

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN sed -i 's/headless: "new"/headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH/' server.js

USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgbm-dev \
    libxshmfence-dev \
    fonts-noto-color-emoji \
    fonts-freefont-ttf \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /tmp/puppeteer_cookies && chmod 777 /tmp/puppeteer_cookies

RUN which google-chrome-stable || echo "Chrome not found at expected path"
RUN ls -la /usr/bin/google-chrome* || echo "No Chrome binaries in /usr/bin"
RUN find / -name chrome -o -name chromium -o -name "google-chrome*" 2>/dev/null || echo "Chrome not found"

RUN node -e "console.log('Puppeteer executable:', require('puppeteer').executablePath())"

RUN ls -lR /home/pptruser/.cache/puppeteer

RUN echo "PUPPETEER_EXECUTABLE_PATH=$PUPPETEER_EXECUTABLE_PATH" \
    && echo "PUPPETEER_CACHE_DIR=$PUPPETEER_CACHE_DIR"

RUN P=$(node -e 'console.log(require("puppeteer").executablePath())') && \
    if [ -f "$P" ]; then stat -c "%U:%G %A %n" "$P"; else echo "Chrome binary not found at $P"; fi

RUN chown -R pptruser:pptruser /home/pptruser/.cache

USER pptruser

CMD ["node", "index.js"]

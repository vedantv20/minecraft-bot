FROM ghcr.io/puppeteer/puppeteer:24.6.1

# Set necessary environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    NODE_ENV=production \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Set working directory
WORKDIR /usr/src/app

# Copy package files first for better caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source code
COPY . .

# Install additional dependencies for render.com
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
    libxrandr2 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Use non-root user provided by puppeteer image
USER pptruser

# Create a directory for cookies with proper permissions
RUN mkdir -p /tmp/puppeteer_cookies && chmod 777 /tmp/puppeteer_cookies

# Run the app with explicit handler for SIGINT and SIGTERM
CMD ["node", "index.js"]
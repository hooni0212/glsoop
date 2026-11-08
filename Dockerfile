# sqlite3 6's Linux prebuilt binary requires a newer glibc than Bookworm provides.
# Keep both stages on the same distribution and load native modules during build.
FROM node:22-trixie-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && node -e "require('sqlite3'); require('sharp')" \
    && npm cache clean --force

FROM node:22-trixie-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends fontconfig fonts-nanum fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

# librsvg resolves SVG text through Fontconfig; SVG @font-face alone is insufficient.
RUN mkdir -p /usr/local/share/fonts/glsoop \
    && cp /app/public/fonts/glsoop-preview/*.ttf /usr/local/share/fonts/glsoop/ \
    && fc-cache -f \
    && test -n "$(fc-list :lang=ko file)" \
    && mkdir -p /app/data/live /app/public/uploads /app/tmp \
    && chown -R node:node /app/data /app/public/uploads /app/tmp

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/readyz').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

# sqlite3 6's Linux prebuilt binary requires a newer glibc than Bookworm provides.
# Keep both stages on the same distribution and load native modules during build.
FROM node:22-trixie-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && node -e "require('sqlite3'); require('sharp')" \
    && npm cache clean --force

FROM node:22-trixie-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

RUN mkdir -p /app/data/live /app/public/uploads && chown -R node:node /app/data /app/public/uploads

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/readyz').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

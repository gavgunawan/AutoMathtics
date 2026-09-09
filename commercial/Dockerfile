# Pinned by digest, not by tag: a tag moves under you, a digest is the image that was reviewed and built in CI.
# This is the multi-arch manifest digest of node:22-bookworm-slim as of 9 Sep 2026 (tag last pushed 25 Aug 2026).
# To bump it: read the tag's current digest from https://hub.docker.com/v2/repositories/library/node/tags/22-bookworm-slim
# (the top-level `digest` field), replace the value below, and let the container-build job prove it still builds.
FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
WORKDIR /app
# Generate and commit package-lock.json before deployment; fail rather than
# silently resolve a different production dependency tree on every build.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-fund --no-audit
COPY server/ ./server/
COPY public/ ./public/
COPY scripts/ ./scripts/
USER node
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server/main.mjs"]

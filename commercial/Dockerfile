FROM node:22-bookworm-slim
WORKDIR /app
# Generate and commit package-lock.json before deployment; fail rather than
# silently resolve a different production dependency tree on every build.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-fund --no-audit
COPY server/ ./server/
COPY public/ ./public/
USER node
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server/main.mjs"]

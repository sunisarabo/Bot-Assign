# PAS graph dashboard — build context = repo root
FROM node:20-alpine
WORKDIR /app
COPY graph ./graph
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "graph/server.js"]

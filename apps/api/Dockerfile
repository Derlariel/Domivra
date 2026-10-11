FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --ignore-scripts
COPY apps/api apps/api
RUN npm run build -w @domivra/api
EXPOSE 3000
CMD ["npm","run","start","-w","@domivra/api"]

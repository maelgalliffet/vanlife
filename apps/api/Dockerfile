FROM node:22-alpine AS build
WORKDIR /app

COPY package.json ./
COPY tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm install

COPY apps/api ./apps/api
RUN npm run build -w apps/api

FROM node:22-alpine
WORKDIR /app

COPY package.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm install --omit=dev

COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/src ./apps/api/src

RUN mkdir -p /app/apps/api/data /app/apps/api/uploads

ENV PORT=4000
EXPOSE 4000

CMD ["node", "apps/api/dist/index.js"]

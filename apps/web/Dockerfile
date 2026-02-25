FROM node:22-alpine AS build
WORKDIR /app

# Ne pas définir VITE_API_URL ici - laisser le fallback runtime utiliser window.location.hostname:4000
COPY package.json ./
COPY tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm install

COPY apps/web ./apps/web
RUN npm run build -w apps/web

FROM nginx:1.27-alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

# syntax=docker/dockerfile:1
# Multi-stage: build the Vite bundle with Node, serve static assets via nginx
# (nginx also reverse-proxies /api to the backend — see nginx.conf).

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

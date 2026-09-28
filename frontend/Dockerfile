# =============================================================================
#  ANWAR KPIFlow — front-end image (React + Vite built, served by Nginx)
#  Nginx also reverse-proxies /api to the `api` service so the refresh-token
#  cookie stays first-party and SameSite=Strict works in Docker.
# =============================================================================

# ---------------------------------------------------------------------- build
FROM node:22-alpine AS build
WORKDIR /app

ARG VITE_API_BASE_URL=/api/v1
ARG VITE_APP_NAME="ANWAR KPIFlow"
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_APP_NAME=$VITE_APP_NAME

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY frontend/tsconfig.json frontend/vite.config.ts frontend/tailwind.config.js frontend/postcss.config.js frontend/index.html ./
COPY frontend/src ./src
RUN npm run build:only

# -------------------------------------------------------------------- runtime
FROM nginx:1.27-alpine AS runtime

RUN apk add --no-cache curl

COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf

# SPA history fallback + security headers
RUN printf 'server {\n\
  listen 80;\n\
  server_name _;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  server_tokens off;\n\
\n\
  add_header X-Content-Type-Options "nosniff" always;\n\
  add_header X-Frame-Options "DENY" always;\n\
  add_header Referrer-Policy "no-referrer" always;\n\
  add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;\n\
\n\
  gzip on;\n\
  gzip_types text/plain text/css application/json application/javascript application/xml image/svg+xml;\n\
  gzip_min_length 1024;\n\
\n\
  location = /healthz { access_log off; return 200 "healthy\\n"; add_header Content-Type text/plain; }\n\
\n\
  location /api/ {\n\
    proxy_pass http://api:4000;\n\
    proxy_http_version 1.1;\n\
    proxy_set_header Host $host;\n\
    proxy_set_header X-Real-IP $remote_addr;\n\
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n\
    proxy_set_header X-Forwarded-Proto $scheme;\n\
    proxy_set_header Upgrade $http_upgrade;\n\
    proxy_set_header Connection "upgrade";\n\
    client_max_body_size 60m;\n\
    proxy_read_timeout 180s;\n\
  }\n\
\n\
  location ~* \\.(?:js|css|woff2?|ttf|eot|svg|png|jpe?g|gif|webp|ico)$ {\n\
    expires 30d;\n\
    add_header Cache-Control "public, immutable";\n\
    try_files $uri =404;\n\
  }\n\
\n\
  location / {\n\
    try_files $uri $uri/ /index.html;\n\
    add_header Cache-Control "no-store";\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=20s --timeout=5s --retries=5 \
  CMD curl -fsS http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]

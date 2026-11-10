# TechWolf Master server: API + admin dashboard (/console) + public download
# page (/), in one container. Build context is the REPO ROOT (see
# docker-compose.yml), because the download page lives in ../Landing.
FROM node:22-slim

WORKDIR /app/MasterControl

# Dependencies first, so rebuilds are fast when only source changes.
COPY MasterControl/package.json MasterControl/package-lock.json ./
COPY MasterControl/db/package.json ./db/
COPY MasterControl/api/package.json ./api/
COPY MasterControl/web/package.json ./web/
RUN npm ci

COPY MasterControl/ /app/MasterControl/
COPY Landing/ /app/Landing/

# Build the admin dashboard that the API serves at /console/.
RUN npm run build --workspace=@masterctl/web

# Uploaded installers live here - mounted as a persistent volume in compose.
RUN mkdir -p /app/MasterControl/releases-data && chown -R node:node /app
USER node

ENV NODE_ENV=production \
    PORT=4100 \
    MASTER_HOST=0.0.0.0 \
    MASTER_TRUST_PROXY=true

EXPOSE 4100
CMD ["npm", "run", "start", "--workspace=@masterctl/api"]

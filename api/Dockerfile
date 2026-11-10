# Builds and runs @masterctl/api. Run from the MasterControl/ directory:
#   docker build -f api/Dockerfile -t master-api .
# (build context is MasterControl/, not MasterControl/api/, so this can
# see the @masterctl/db workspace package too - see docker-compose.yml
# which wires this up correctly already.)

FROM node:22-alpine AS base
WORKDIR /app

# Install dependencies for both workspace packages together so npm can
# correctly link @masterctl/db into @masterctl/api's node_modules.
COPY package.json ./
COPY db/package.json ./db/package.json
COPY api/package.json ./api/package.json
RUN npm install

COPY db ./db
COPY api ./api

WORKDIR /app/api
EXPOSE 4100
CMD ["npm", "run", "start"]

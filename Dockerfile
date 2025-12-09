# Use a Node.js image based on Alpine Linux
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json first
# This allows Docker to cache the npm install step.
COPY package.json package-lock.json ./

# Install all Node.js dependencies
# `npm ci` is preferred over `npm install` for reproducible builds.
# We use --unsafe-perm because npm is running as root inside the container
# and some packages with native dependencies might require it.
RUN npm ci --unsafe-perm

# Copy the rest of your application code into the container
# The .dockerignore file will prevent node_modules from being copied again.
COPY . .

# Command to run your application when the container starts
# Assumes 'testsubs.js' is your main application file.
CMD ["node", "index.js"]

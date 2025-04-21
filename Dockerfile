# Use official Node.js LTS image
FROM node:20

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the code
COPY . .

# Expose backend port
EXPOSE 3000

# Use environment variables for API keys and config (set via Render dashboard)
# Do NOT copy .env (handled by Render)

# Start the backend
CMD ["npm", "run", "dev"]

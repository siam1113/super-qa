# Supply an immutable browser base matching the lockfile's framework version.
ARG QA_BROWSER_BASE
FROM ${QA_BROWSER_BASE}
USER root
WORKDIR /opt/qa
ENV CYPRESS_CACHE_FOLDER=/opt/qa/cypress-cache
COPY package.json package-lock.json ./
# Dependency setup is an operator image-build step, never a model-supplied command.
RUN npm ci --ignore-scripts && node -e "const fs=require('fs'),cp=require('child_process'),crypto=require('crypto'); if(fs.existsSync('node_modules/cypress/bin/cypress')) cp.execFileSync(process.execPath,['node_modules/cypress/bin/cypress','install'],{stdio:'inherit'}); fs.writeFileSync('lock.sha256',crypto.createHash('sha256').update(fs.readFileSync('package-lock.json')).digest('hex'))" && chmod -R a+rX /opt/qa
USER 1000:1000

const { scryptSync, randomBytes } = require('crypto');
const { createInterface } = require('readline/promises');
const { stdin, stdout } = require('process');
const { DataSource } = require('typeorm');
const { databaseConfig } = require('../dist/config/database.config.js');
const { QaSuperAdmin } = require('../dist/modules/autonomy/identity.entity.js');
const { QaOrgMember } = require('../dist/modules/autonomy/identity.entity.js');

function readSecret(prompt) {
  if (!stdin.isTTY || !stdin.setRawMode) throw new Error('Run this command from an interactive terminal.');
  return new Promise((resolve, reject) => {
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    const onData = chunk => {
      if (chunk === '\u0003') { cleanup(); reject(new Error('Cancelled.')); return; }
      if (chunk === '\r' || chunk === '\n') { cleanup(); stdout.write('\n'); resolve(value); return; }
      if (chunk === '\u007f' || chunk === '\b') { value = value.slice(0, -1); stdout.write('\b \b'); return; }
      if (chunk >= ' ') { value += chunk; stdout.write('*'); }
    };
    const cleanup = () => { stdin.removeListener('data', onData); stdin.setRawMode(false); };
    let value = '';
    stdin.on('data', onData);
  });
}

async function main() {
  const terminal = createInterface({ input: stdin, output: stdout });
  const email = (await terminal.question('Super admin email: ')).trim().toLowerCase();
  terminal.close();
  stdin.resume();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid email address.');
  const password = await readSecret('Password (12+ chars): ');
  const confirmation = await readSecret('Confirm password: ');
  if (password.length < 12 || password.length > 256 || password !== confirmation) throw new Error('Passwords must match and contain 12–256 characters.');
  const salt = randomBytes(16).toString('hex');
  const passwordHash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
  const database = new DataSource({ ...databaseConfig, synchronize: false });
  await database.initialize();
  try {
    const duplicate = await database.manager.findOneBy(QaSuperAdmin, { email });
    if (duplicate) throw new Error('A super admin with that email already exists.');
    if (await database.manager.findOneBy(QaOrgMember, { email })) throw new Error('That email already belongs to an organization account.');
    if (await database.manager.count(QaSuperAdmin)) stdout.write('Adding another super admin account.\n');
    await database.manager.save(database.manager.create(QaSuperAdmin, { email, passwordHash, active: true }));
    stdout.write(`Created super admin ${email}. Sign in at ${process.env.AUTH_PUBLIC_URL || 'http://localhost:3000'}/login.\n`);
  } finally { await database.destroy(); }
}

main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

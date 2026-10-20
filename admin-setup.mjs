import { emitKeypressEvents } from 'node:readline';
import { mkdirSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { adminAuthPath, hashPassword } from '../lib/admin.mjs';

const file = adminAuthPath();
const replace = process.argv.includes('--alterar');
if (existsSync(file) && !replace) {
  console.error('Já existe uma senha. Para substituí-la, execute npm run admin:setup -- --alterar.');
  process.exit(1);
}
if (!process.stdin.isTTY) { console.error('Execute em um terminal interativo para cadastrar a senha com segurança.'); process.exit(1); }
function secret(prompt) {
  return new Promise(resolve => {
    let value = '';
    process.stdout.write(prompt);
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const listener = (str, key = {}) => {
      if (key.ctrl && key.name === 'c') { process.stdin.setRawMode(false); process.stdout.write('\n'); process.exit(130); }
      if (key.name === 'return' || key.name === 'enter') {
        process.stdin.off('keypress', listener); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); resolve(value);
      } else if (key.name === 'backspace') value = [...value].slice(0, -1).join('');
      else if (!key.ctrl && !key.meta && str && !str.includes('\u001b')) value += str;
    };
    process.stdin.on('keypress', listener);
  });
}
try {
  const password = await secret('Escolha a senha do painel (mínimo 12 caracteres; não será exibida): ');
  const credential = hashPassword(password);
  const confirm = await secret('Repita a senha: ');
  if (password !== confirm) throw new Error('As senhas não coincidem. Nada foi salvo.');
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(credential) + '\n', { mode: 0o600, flag: replace ? 'w' : 'wx' });
  chmodSync(file, 0o600);
  console.log('Senha cadastrada. Reinicie o servidor e abra /admin no domínio do site.');
} catch (error) { console.error(error.message); process.exitCode = 1; }

// 최소 SMTP 클라이언트 — 제휴 링크 요청 메일 발송용
//
// 외부 의존성 없이 SMTP(465 SSL / 587 STARTTLS)로 메일 한 통을 보낸다.
// 필요한 환경변수(하나라도 없으면 조용히 건너뛴다):
//   SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_TO
//   (선택) SMTP_PORT 기본 465, MAIL_FROM 기본 SMTP_USER
//
// Gmail 을 쓰는 경우: 일반 비밀번호가 아니라 "앱 비밀번호"를 발급해 SMTP_PASS 에 넣어야 한다.
import net from 'node:net';
import tls from 'node:tls';

export function mailConfigured() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_TO } = process.env;
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASS && MAIL_TO);
}

/** 헤더에 안전한 한 줄로 (개행 주입 방지) */
function headerSafe(s) {
  return String(s).replace(/[\r\n]+/g, ' ').trim();
}

/** 비ASCII 제목을 위한 RFC 2047 인코딩 */
function encodeHeader(s) {
  const clean = headerSafe(s);
  if (/^[\x20-\x7E]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function readReply(socket) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (d) => {
      buf += d.toString('utf8');
      // 마지막 줄이 "250 " 처럼 코드 뒤 공백이면 응답 완료
      const lines = buf.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || '';
      if (/^\d{3} /.test(last)) {
        cleanup();
        const code = parseInt(last.slice(0, 3), 10);
        if (code >= 400) reject(new Error(`SMTP ${code}: ${last}`));
        else resolve(buf);
      }
    };
    const onErr = (e) => { cleanup(); reject(e); };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onErr);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => onErr(new Error('SMTP 응답 시간 초과')), 20000);
    socket.on('data', onData);
    socket.on('error', onErr);
  });
}

async function cmd(socket, line, expectReply = true) {
  socket.write(line + '\r\n');
  if (expectReply) return readReply(socket);
}

/**
 * 메일 한 통 발송. 설정이 없으면 { sent:false, reason } 을 돌려준다(예외 아님).
 * @param {{subject: string, text: string}} msg
 */
export async function sendMail({ subject, text }) {
  if (!mailConfigured()) return { sent: false, reason: 'SMTP 환경변수 미설정' };
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to = process.env.MAIL_TO;
  const from = process.env.MAIL_FROM || user;

  let socket;
  try {
    // 465 는 처음부터 TLS, 그 외 포트는 STARTTLS 로 승격
    if (port === 465) {
      socket = tls.connect({ host, port, servername: host });
      await new Promise((res, rej) => {
        socket.once('secureConnect', res);
        socket.once('error', rej);
      });
      await readReply(socket);
    } else {
      socket = net.connect({ host, port });
      await new Promise((res, rej) => {
        socket.once('connect', res);
        socket.once('error', rej);
      });
      await readReply(socket);
      await cmd(socket, `EHLO ktrend.kr`);
      await cmd(socket, 'STARTTLS');
      socket = tls.connect({ socket, servername: host });
      await new Promise((res, rej) => {
        socket.once('secureConnect', res);
        socket.once('error', rej);
      });
    }

    await cmd(socket, `EHLO ktrend.kr`);
    await cmd(socket, 'AUTH LOGIN');
    await cmd(socket, Buffer.from(user, 'utf8').toString('base64'));
    await cmd(socket, Buffer.from(pass, 'utf8').toString('base64'));
    await cmd(socket, `MAIL FROM:<${headerSafe(from)}>`);
    await cmd(socket, `RCPT TO:<${headerSafe(to)}>`);
    await cmd(socket, 'DATA');

    const body = [
      `From: ${headerSafe(from)}`,
      `To: ${headerSafe(to)}`,
      `Subject: ${encodeHeader(subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
      '.',
    ].join('\r\n');
    await cmd(socket, body);
    await cmd(socket, 'QUIT', false);
    socket.end();
    return { sent: true, to };
  } catch (err) {
    try { socket?.destroy(); } catch { /* 무시 */ }
    return { sent: false, reason: err.message || String(err) };
  }
}

import http from 'node:http';
import type express from 'express';
import { arquivoBanco } from './db';

// Com o Litestream rodando (deploy/iniciar.sh define LITESTREAM_SOCKET), a resposta de toda escrita só sai depois de ele confirmar
// o envio ao Cloud Storage: na cobrança por requisição o Cloud Run tira a CPU da instância entre as requisições, e o envio em segundo
// plano ficaria para a requisição seguinte ou para o desligamento. Sem o socket (desenvolvimento local), não faz nada.
const socket = process.env.LITESTREAM_SOCKET;
// segundos que a resposta espera o Litestream; depois disso ela sai mesmo assim, porque o dado já está gravado na instância e vai no próximo envio
const espera = 5;

const sincronizar = () => new Promise<void>((pronto) => {
  const falhou = (motivo: string) => { console.error(`Litestream não confirmou o envio ao Cloud Storage: ${motivo}`); pronto(); };
  const pedido = http.request({ socketPath: socket, path: '/sync', method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: (espera + 2) * 1000 }, (resposta) => {
    let corpo = '';
    resposta.setEncoding('utf8').on('data', (parte) => { corpo += parte; }).on('end', () => (resposta.statusCode === 200 ? pronto() : falhou(`${resposta.statusCode} ${corpo}`)));
  });
  pedido.on('timeout', () => pedido.destroy(new Error('tempo esgotado'))).on('error', (erro) => falhou(erro.message));
  pedido.end(JSON.stringify({ path: arquivoBanco, wait: true, timeout: espera }));
});

// segura o res.end das rotas que alteram dados até o envio (as de leitura passam direto)
export const aguardarReplicacao: express.RequestHandler = (req, res, next) => {
  if (!socket || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const end = res.end.bind(res) as (...args: unknown[]) => express.Response;
  res.end = ((...args: unknown[]) => { void sincronizar().then(() => end(...args)); return res; }) as typeof res.end;
  next();
};

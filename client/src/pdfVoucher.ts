import { jsPDF } from 'jspdf';
import { money } from './api';
import { formatDay } from './datas';
import { code128 } from './codigoBarras';

/** O que o PDF usa de GET /vouchers/:id: o voucher e os dados da unidade. */
export type DetalheVoucher = { codigo: string; unidade_nome: string; valor: number; email: string; nome: string; origem: string | null; data_emissao: string; validade: string; unidade_endereco: string | null; unidade_telefone: string | null; regras_voucher: string };

type Cor = [number, number, number];
const MARGEM = 16;
// identidade do Grupo Tropicalia, a mesma da tela de login: degradê grafite → vermelho queimado e âmbar
const GRAFITE: Cor = [43, 43, 43];
const VERMELHO_QUEIMADO: Cor = [109, 34, 18];
const AMBAR: Cor = [226, 154, 48];
const CINZA: Cor = [112, 131, 141];
const ALTURA_FAIXA = 60;
const ALTURA_BARRAS = 18;
// o Intl separa "R$" do número com espaços Unicode; a fonte padrão do jsPDF só garante o espaço comum
const texto = (conteudo: string) => conteudo.replace(/\s/g, ' ');
// logo de cada unidade pelo nome (client/public); a unidade sem logo leva o nome escrito na faixa.
// Os de fundo transparente são brancos e vão direto na faixa; o do Delivery tem fundo próprio e entra como um quadrado
const logos = [{ trecho: 'TERRA', arquivo: '/logo-terra-mar.png', altura: 26 }, { trecho: 'PIZZARIA', arquivo: '/logo-restaurante-pizzaria.png', altura: 26 }, { trecho: 'DELIVERY', arquivo: '/logo-delivery.png', altura: 42 }];

async function carregarImagem(caminho: string) {
  try {
    const resposta = await fetch(caminho);
    // caminho que não existe volta o index.html do SPA com status 200
    if (!resposta.ok || !resposta.headers.get('content-type')?.startsWith('image/')) return null;
    const blob = await resposta.blob();
    return await new Promise<string>((resolver, rejeitar) => { const leitor = new FileReader(); leitor.onload = () => resolver(leitor.result as string); leitor.onerror = rejeitar; leitor.readAsDataURL(blob); });
  } catch { return null; }
}

/** Gera e baixa o PDF do voucher (A4), no modelo do vale consumo: faixa com o logo, título com o valor, código, regras de uso,
 * identificação, endereço da unidade, código de barras (Code 128) e linha para a assinatura. */
export async function exportarPdfVoucher(voucher: DetalheVoucher) {
  const doc = new jsPDF();
  const largura = doc.internal.pageSize.getWidth();
  const altura = doc.internal.pageSize.getHeight();
  const util = largura - 2 * MARGEM;

  // o jsPDF não tem degradê simples: a faixa é feita de tiras verticais com a cor interpolada
  const tiras = 105;
  for (let tira = 0; tira < tiras; tira++) {
    const fracao = tira / (tiras - 1);
    doc.setFillColor(...GRAFITE.map((canal, indice) => Math.round(canal + (VERMELHO_QUEIMADO[indice] - canal) * fracao)) as Cor);
    doc.rect(tira * largura / tiras, 0, largura / tiras + 0.3, ALTURA_FAIXA, 'F');
  }
  const logo = logos.find((item) => voucher.unidade_nome.toUpperCase().includes(item.trecho));
  const imagem = logo ? await carregarImagem(logo.arquivo) : null;
  if (logo && imagem) {
    const { width, height } = doc.getImageProperties(imagem);
    doc.addImage(imagem, 'PNG', MARGEM, (ALTURA_FAIXA - logo.altura) / 2, logo.altura * width / height, logo.altura);
  } else {
    doc.setTextColor(255, 255, 255).setFont('helvetica', 'bold').setFontSize(28).text('Tropicalia', MARGEM, 31);
    doc.setTextColor(...AMBAR).setFontSize(12).text(doc.splitTextToSize(texto(voucher.unidade_nome), 100), MARGEM, 40);
  }
  doc.setTextColor(...AMBAR).setFont('helvetica', 'bold').setFontSize(10).text('VALE CONSUMO', largura - MARGEM, 27, { align: 'right' });
  doc.setTextColor(255, 255, 255).setFontSize(30).text(texto(money(voucher.valor)), largura - MARGEM, 40, { align: 'right' });

  let y = ALTURA_FAIXA + 16;
  doc.setTextColor(...GRAFITE).setFont('helvetica', 'bold').setFontSize(15);
  const titulo = doc.splitTextToSize(texto(`VALE CONSUMO ${voucher.unidade_nome} TROPICALIA ${money(voucher.valor)}`.toUpperCase()), util);
  doc.text(titulo, MARGEM, y); y += titulo.length * 6.5;
  doc.setFontSize(12).text(voucher.codigo, MARGEM, y); y += 13;

  doc.setFontSize(11).text('REGRAS DE USO:', MARGEM, y); y += 7;
  doc.setFont('helvetica', 'normal').setFontSize(10.5);
  const regras = [...voucher.regras_voucher.split('\n').filter(Boolean), `Validade: até ${formatDay(voucher.validade)}.`];
  regras.forEach((regra, indice) => { const linhas = doc.splitTextToSize(texto(`${indice + 1}. ${regra}`), util); doc.text(linhas, MARGEM, y); y += linhas.length * 5.4; });
  y += 7;

  const campo = (rotulo: string, valor: string) => {
    doc.setFont('helvetica', 'bold').text(`${rotulo}:`, MARGEM, y);
    const recuo = doc.getTextWidth(`${rotulo}: `);
    const linhas = doc.splitTextToSize(texto(valor), util - recuo);
    doc.setFont('helvetica', 'normal').text(linhas, MARGEM + recuo, y); y += linhas.length * 5.6;
  };
  campo('Nome completo', voucher.nome);
  campo('E-mail', voucher.email);
  campo('Emissão', formatDay(voucher.data_emissao));
  campo('Validade', formatDay(voucher.validade));
  if (voucher.origem) campo('Origem', voucher.origem);
  y += 8;

  doc.setFont('helvetica', 'bold').text('É indispensável a apresentação deste voucher.', MARGEM, y); y += 5.6;
  const contato = [voucher.unidade_endereco, voucher.unidade_telefone && `Fone: ${voucher.unidade_telefone}`].filter(Boolean).join(' · ');
  if (contato) { const linhas = doc.splitTextToSize(texto(contato), util); doc.setFont('helvetica', 'normal').text(linhas, MARGEM, y); y += linhas.length * 5.6; }
  y += 12;

  // código de barras em preto, no máximo 95 mm (o código digitado pode ter até 40 caracteres), e a assinatura à direita
  const larguras = code128(voucher.codigo);
  const modulos = larguras.reduce((total, modulo) => total + modulo, 0);
  const modulo = Math.min(0.55, 95 / modulos);
  doc.setFillColor(0, 0, 0);
  larguras.reduce((x, larguraBarra, indice) => { if (indice % 2 === 0) doc.rect(x, y, larguraBarra * modulo, ALTURA_BARRAS, 'F'); return x + larguraBarra * modulo; }, MARGEM);
  doc.setTextColor(...GRAFITE).setFont('helvetica', 'normal').setFontSize(9).text(voucher.codigo, MARGEM + modulos * modulo / 2, y + ALTURA_BARRAS + 5, { align: 'center' });
  const inicioAssinatura = largura - MARGEM - 72;
  doc.setDrawColor(...GRAFITE).setLineWidth(0.3).line(inicioAssinatura, y + ALTURA_BARRAS, largura - MARGEM, y + ALTURA_BARRAS);
  doc.setTextColor(...CINZA).text('Assinatura do responsável', inicioAssinatura + 36, y + ALTURA_BARRAS + 5, { align: 'center' });

  doc.setDrawColor(...AMBAR).setLineWidth(0.8).line(MARGEM, altura - 18, largura - MARGEM, altura - 18);
  doc.setTextColor(...CINZA).setFontSize(8.5).text('Grupo Tropicalia · Olímpia-SP', MARGEM, altura - 12);
  doc.text(`Voucher ${voucher.codigo}`, largura - MARGEM, altura - 12, { align: 'right' });
  doc.save(`voucher-${voucher.codigo}.pdf`);
}

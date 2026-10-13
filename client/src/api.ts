const API = import.meta.env.VITE_API_URL || '/api';

export const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export async function request(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem('token');
  // sem conexão o fetch rejeita com a mensagem do navegador, em inglês ("Failed to fetch")
  const response = await fetch(`${API}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } }).catch(() => { throw new Error('Sem conexão com o servidor. Verifique a internet e tente de novo.'); });
  // o corpo vazio (204) vale {}; já um corpo que não chega inteiro (a conexão caiu no meio, comum no celular) é erro,
  // mesmo com status 200: devolver {} faria a tela receber um objeto no lugar da lista e quebrar inteira
  const corpo = await response.text().catch(() => null);
  let data;
  try { data = corpo ? JSON.parse(corpo) : {}; } catch { data = null; }
  if (!response.ok) throw Object.assign(new Error(data?.erro || 'Não foi possível concluir a operação.'), { status: response.status });
  if (corpo === null || data === null) throw new Error('A resposta do servidor chegou incompleta. Verifique a internet e tente de novo.');
  return data;
}

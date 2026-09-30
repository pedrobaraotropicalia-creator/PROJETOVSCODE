const API = import.meta.env.VITE_API_URL || '/api';

export const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export async function request(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem('token');
  const response = await fetch(`${API}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.erro || 'Não foi possível concluir a operação.');
  return data;
}

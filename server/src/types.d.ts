declare namespace Express { interface Request { user?: { id: number; nome: string; email: string; tipo: 'funcionario' | 'admin' | 'dono'; cargo: string | null } } }

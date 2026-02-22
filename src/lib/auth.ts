const API_BASE_URL = import.meta.env.VITE_API_URL || '';

interface LoginResponse {
  token: string;
  portfolioId: string;
  isAdmin: boolean;
  expiresAt: string;
}

export async function loginToPortfolio(
  portfolioId: string,
  password: string
): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ portfolioId, password }),
  });

  if (response.status === 401) {
    throw new Error('Invalid password');
  }
  if (response.status === 404) {
    throw new Error('Portfolio not found');
  }
  if (!response.ok) {
    throw new Error('Failed to log in');
  }

  return response.json();
}

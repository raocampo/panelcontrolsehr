import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5620';

const api = axios.create({
  baseURL: `${API_BASE}/api`,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('panel_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('panel_token');
      localStorage.removeItem('panel_staff');
      window.location.href = '/';
    }
    return Promise.reject(error);
  },
);

export default api;

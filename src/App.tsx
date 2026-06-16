import { useEffect, useState } from 'react';

export default function App() {
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/hello')
      .then(r => r.json() as Promise<{ message: string }>)
      .then(data => setMessage(data.message))
      .catch(() => setMessage('Failed to fetch'));
  }, []);

  return (
    <div style={{ fontFamily: 'system-ui', padding: '2rem' }}>
      <h1>Mushoku Chronicles</h1>
      <p>{message || 'Loading...'}</p>
    </div>
  );
}

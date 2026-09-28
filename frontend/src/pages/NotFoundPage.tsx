import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card } from '@/components/ui';

/** Unknown route — rendered inside the authenticated shell (M01 routing). */
const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <Card className="mx-auto max-w-lg text-center">
      <p className="anwar-mono text-h1 text-navy-300" aria-hidden="true">
        404
      </p>
      <h1 className="mt-2 text-h2 text-navy-900">Page not found</h1>
      <p className="mt-1 text-body text-ink-secondary">
        The page you are looking for does not exist or may have moved.
      </p>
      <div className="mt-5 flex justify-center">
        <Button onClick={() => navigate('/my-kpi')}>Back to My KPI</Button>
      </div>
    </Card>
  );
};

export default NotFoundPage;

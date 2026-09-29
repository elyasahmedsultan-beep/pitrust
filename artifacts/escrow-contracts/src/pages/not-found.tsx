import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-[60dvh] w-full items-center justify-center">
      <Card className="mx-4 w-full max-w-md border-border bg-card shadow-xs">
        <CardContent className="pt-6">
          <div className="mb-4 flex gap-3">
            <AlertCircle className="h-8 w-8 text-primary" />
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[.16em] text-primary">PiTrust</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-[-.03em]">
                Page not found
              </h1>
            </div>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            This page does not belong to the current workspace.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

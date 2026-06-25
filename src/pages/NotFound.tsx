import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen grid place-items-center bg-background p-6">
      <div className="text-center">
        <div className="text-6xl font-semibold">404</div>
        <div className="text-muted-foreground mt-2">This page doesn't exist.</div>
        <Button asChild className="mt-6"><Link to="/">Back to Dashboard</Link></Button>
      </div>
    </div>
  );
}

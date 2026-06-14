import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-6xl font-bold text-muted-foreground">404</p>
      <p className="text-lg">Página no encontrada</p>
      <Link href="/" className="text-primary underline-offset-4 hover:underline">
        Ir al inicio
      </Link>
    </main>
  );
}

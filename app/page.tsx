import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-32 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">RoyalPal</h1>
      <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">
        Find a tutor, book a lesson, learn something new.
      </p>
      <div className="flex gap-4">
        <Link
          href="/signup"
          className="bg-foreground text-background rounded-full px-5 py-3 font-medium"
        >
          Get started
        </Link>
        <Link
          href="/login"
          className="rounded-full border border-black/15 px-5 py-3 font-medium dark:border-white/20"
        >
          Log in
        </Link>
      </div>
    </div>
  );
}

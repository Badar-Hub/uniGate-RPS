// Root-level not-found for paths outside a locale segment (the middleware normally redirects first).
export default function RootNotFound() {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <p>404</p>
      </body>
    </html>
  );
}

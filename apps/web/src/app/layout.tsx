import type { Metadata } from 'next';
import './globals.css';

const BASE_URL = 'https://www.alphaitgroup.com';

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: 'Alpha IT Hub | Agentes de IA para Tiendas de Ropa y Calzado',
  description:
    'Alpha IT Hub: sistema ERP con agentes de inteligencia artificial para tiendas de indumentaria y calzado. Gestioná stock, ventas y compras con IA especializada en moda. Analítica avanzada para el retail argentino.',
  keywords:
    'agentes IA, gestión tienda ropa, software calzado, IA para retail moda, hub de agentes, automatización indumentaria, analítica ventas ropa, ERP moda IA, sistema punto de venta ropa, software gestión indumentaria argentina',
  authors: [{ name: 'Alpha IT Hub', url: BASE_URL }],
  creator: 'Alpha IT Hub',
  publisher: 'Alpha IT Hub',
  robots: { index: true, follow: true },
  alternates: {
    canonical: BASE_URL,
    languages: { 'es-AR': BASE_URL },
  },
  openGraph: {
    type: 'website',
    url: BASE_URL,
    title: 'Alpha IT Hub | Agentes de IA para Tiendas de Ropa y Calzado',
    description:
      'Sistema ERP con IA especializada para el retail de moda. Gestioná stock, ventas y compras con agentes de inteligencia artificial que conocen tu negocio.',
    siteName: 'Alpha IT Hub',
    images: [
      {
        url: `${BASE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: 'Alpha IT Hub — Agentes de IA para tiendas de ropa y calzado',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Alpha IT Hub | Agentes de IA para Tiendas de Ropa',
    description:
      'Sistema ERP con agentes de IA especializados en moda e indumentaria. Analítica, stock, ventas y automatización para tu comercio.',
    images: [`${BASE_URL}/og-image.png`],
  },
};

// JSON-LD: Organization + SoftwareApplication schemas
const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Alpha IT Hub',
  url: BASE_URL,
  logo: `${BASE_URL}/alpha-logo.png`,
  description:
    'Empresa de tecnología especializada en soluciones de gestión e inteligencia artificial para tiendas de indumentaria y calzado en Argentina.',
  sameAs: [
    'https://www.instagram.com/alphaitgroup',
    'https://www.linkedin.com/company/alphaitgroup',
  ],
  contactPoint: {
    '@type': 'ContactPoint',
    telephone: '+54-3455-463110',
    contactType: 'customer support',
    areaServed: 'AR',
    availableLanguage: 'Spanish',
  },
};

const softwareSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Alpha IT Hub',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web, iOS, Android',
  description:
    'Sistema ERP con hub de agentes de inteligencia artificial para la gestión integral de tiendas de ropa y calzado. Incluye punto de venta, analítica avanzada, gestión de stock y automatización mediante IA.',
  url: BASE_URL,
  author: {
    '@type': 'Organization',
    name: 'Alpha IT Hub',
  },
  offers: {
    '@type': 'Offer',
    availability: 'https://schema.org/InStock',
    areaServed: 'AR',
    priceCurrency: 'ARS',
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-AR" className="dark" style={{ scrollBehavior: 'smooth' }}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <link rel="hreflang" href={BASE_URL} hrefLang="es-AR" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }}
        />
      </head>
      <body className="font-sans antialiased bg-dark text-white">
        {children}
      </body>
    </html>
  );
}

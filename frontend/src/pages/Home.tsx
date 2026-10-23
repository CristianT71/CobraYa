import { useEffect, useState } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { api, type ServiceInfo } from '../lib/api';

// Se muestra mientras llega /public/info (o si el servicio no responde): la
// portada nunca queda vacía.
const FALLBACK_SCOPE: ServiceInfo['scope'] = {
  does: [
    'Cuentas de cobro con sus ítems y cálculo exacto de subtotal, impuesto y total',
    'Pagos únicos y completos',
    'Comprobantes con consecutivo interno',
  ],
  does_not: [
    'Facturación electrónica ni DIAN',
    'Contabilidad (libros, balances, reportes tributarios)',
    'Procesamiento de tarjetas ni movimiento de dinero: el pago se registra en el sistema',
  ],
};

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'calculator',
    title: 'Cuentas de cobro exactas',
    text: 'Subtotal, impuesto y total se calculan con aritmética decimal exacta, nunca con la IA. Lo que cobramos hoy es lo mismo que cobraremos mañana.',
  },
  {
    icon: 'receipt',
    title: 'Pagos y comprobantes',
    text: 'Registramos el pago, pasamos la cuenta a pagada y emitimos un comprobante con consecutivo que tu cliente puede verificar en esta página.',
  },
  {
    icon: 'chat',
    title: 'Habla como hablas',
    text: '«Cóbrale a la cédula 1032456789 un cambio de aceite de 80.000, pagó en efectivo». La IA solo entiende la frase; el código decide y guarda.',
  },
  {
    icon: 'key',
    title: 'Una key por negocio',
    text: 'Cada negocio ve y toca solo lo suyo. Lo ajeno responde igual que lo inexistente, con límites por minuto y por día.',
  },
  {
    icon: 'shield',
    title: 'Sin cobros duplicados',
    text: 'Con una clave de idempotencia, reintentar una petición devuelve el mismo resultado: ni cuentas ni pagos repetidos.',
  },
  {
    icon: 'link',
    title: 'Hecho para conectarse',
    text: 'Tu bot nos habla por A2A: tarjeta pública, habilidades con datos estructurados y respuestas listas para mostrar.',
  },
];

const HIGHLIGHTS = [
  { value: '6', label: 'habilidades disponibles' },
  { value: '100 %', label: 'aritmética decimal exacta' },
  { value: '1 key', label: 'por cada negocio' },
  { value: 'A2A', label: 'listo para tu bot' },
];

function HeroPreview() {
  return (
    <div className="preview" aria-label="Ejemplo de una cuenta de cobro">
      <p className="preview-tag">Ejemplo</p>
      <div className="bubble bubble-in">
        Cóbrale a la cédula 1032456789 un cambio de aceite de 80.000, pagó en
        efectivo
      </div>
      <div className="bubble bubble-out">
        <span className="bubble-ok">
          <Icon name="check" />
        </span>
        Listo. Cuenta pagada en efectivo por $95.200.
      </div>
      <div className="doc">
        <div className="doc-head">
          <span>Comprobante</span>
          <span className="pill">Pagada</span>
        </div>
        <dl className="doc-lines">
          <div>
            <dt>Cambio de aceite</dt>
            <dd>$80.000</dd>
          </div>
          <div>
            <dt>Impuesto (19 %)</dt>
            <dd>$15.200</dd>
          </div>
        </dl>
        <div className="doc-total">
          <span>Total</span>
          <strong>$95.200</strong>
        </div>
      </div>
    </div>
  );
}

export function Home() {
  const [info, setInfo] = useState<ServiceInfo | null>(null);

  useEffect(() => {
    let active = true;
    api
      .info()
      .then((data) => {
        if (active) setInfo(data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const scope = info?.scope ?? FALLBACK_SCOPE;

  return (
    <>
      <section className="hero" aria-labelledby="titulo">
        <div className="hero-copy">
          <p className="eyebrow">Facturación para negocios conectados</p>
          <h1 id="titulo">Facturación y Pagos</h1>
          <p className="lead">
            El negocio que cobra por los demás. Tu taller, concesionario o
            tienda de repuestos le pide una cuenta de cobro, un pago o un
            comprobante, ya sea con una frase en español o con datos
            estructurados, y recibe el total exacto y el comprobante.
          </p>
          <div className="actions">
            <a className="btn btn-light" href="#/negocios">
              Conectar mi negocio
            </a>
            <a className="btn btn-outline-light" href="#/comprobantes">
              Verificar un comprobante
            </a>
          </div>
          <ul className="chips">
            <li>
              <Icon name="bolt" />
              Respuesta lista para tu cliente
            </li>
            <li>
              <Icon name="shield" />
              Sin duplicados
            </li>
            <li>
              <Icon name="clock" />
              Disponible todo el día
            </li>
          </ul>
        </div>
        <HeroPreview />
      </section>

      <ul className="highlights" aria-label="En cifras">
        {HIGHLIGHTS.map((item) => (
          <li key={item.label}>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </li>
        ))}
      </ul>

      <section className="section" aria-labelledby="que-hacemos">
        <h2 id="que-hacemos">Qué hacemos por tu negocio</h2>
        <p className="intro">
          Todo el ciclo de cobro en un solo lugar: de la frase del cliente al
          comprobante.
        </p>
        <div className="grid">
          {FEATURES.map((feature) => (
            <article className="card feature" key={feature.title}>
              <span className="feature-icon">
                <Icon name={feature.icon} />
              </span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="como-funciona">
        <h2 id="como-funciona">Cómo funciona</h2>
        <ol className="steps">
          <li>
            <strong>Recibes tu key</strong>
            Registramos tu negocio y te entregamos una key propia. Con ella solo
            ves y tocas lo tuyo.
          </li>
          <li>
            <strong>Pides lo que necesitas</strong>
            Una frase en español, o una habilidad con sus datos: cliente, cuenta,
            pago o consulta.
          </li>
          <li>
            <strong>Calculamos y guardamos</strong>
            El código valida, calcula y guarda todo en una sola transacción: o
            queda completo o no queda nada.
          </li>
          <li>
            <strong>Te respondemos</strong>
            Con el total, el comprobante y un texto listo para mostrar a tu
            cliente.
          </li>
        </ol>
      </section>

      <section className="section" aria-labelledby="alcance">
        <h2 id="alcance">Lo que somos y lo que no</h2>
        <p className="intro">
          Somos facturación: cobrar y comprobar. No somos un sistema contable.
        </p>
        <div className="two-col">
          <div className="card scope-yes">
            <h3>Lo que sí hacemos</h3>
            <ul className="scope-list">
              {scope.does.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="card scope-no">
            <h3>Lo que no hacemos</h3>
            <ul className="scope-list">
              {scope.does_not.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {info && (
        <section className="section" aria-labelledby="habilidades">
          <h2 id="habilidades">Habilidades disponibles</h2>
          <ul className="skill-list">
            {info.skills.map((skill) => (
              <li key={skill.id}>
                <code className="inline">{skill.id}</code>
                <span>{skill.description}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="cta" aria-labelledby="cta-titulo">
        <div>
          <h2 id="cta-titulo">¿Listo para cobrar sin complicarte?</h2>
          <p>
            Pide la key de tu negocio y prueba una cuenta de cobro en la consola
            en menos de cinco minutos.
          </p>
        </div>
        <a className="btn btn-light" href="#/negocios">
          Ir a la guía y la consola
        </a>
      </section>
    </>
  );
}

import { useEffect, useState } from 'react';
import { api, type ServiceInfo } from '../lib/api';

// Se muestra mientras llega /public/info (o si el servicio no responde): la
// portada nunca queda vacía.
const FALLBACK_SCOPE: ServiceInfo['scope'] = {
  does: [
    'Cuentas de cobro con sus ítems y cálculo exacto de subtotal, impuesto y total',
    'Pagos simulados, únicos y completos',
    'Comprobantes con consecutivo interno',
  ],
  does_not: [
    'Facturación electrónica ni DIAN',
    'Contabilidad (libros, balances, reportes tributarios)',
    'Cobros de dinero reales',
  ],
};

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
        <div>
          <h1 id="titulo">Facturación y Pagos</h1>
          <p className="lead">
            El negocio que cobra por los demás. Tu taller, concesionario o
            tienda de repuestos le pide una cuenta de cobro, un pago o un
            comprobante, ya sea con una frase en español o con datos
            estructurados, y recibe el total exacto y el comprobante.
          </p>
        </div>
        <div className="actions">
          <a className="btn" href="#/negocios">
            Conectar mi negocio
          </a>
          <a className="btn btn-secondary" href="#/comprobantes">
            Verificar un comprobante
          </a>
        </div>
      </section>

      <section className="section" aria-labelledby="que-hacemos">
        <h2 id="que-hacemos">Qué hacemos por tu negocio</h2>
        <div className="grid">
          <article className="card">
            <h3>Cuentas de cobro exactas</h3>
            <p>
              Subtotal, impuesto y total se calculan con aritmética decimal
              exacta, nunca con la IA. Lo que te cobramos hoy es lo mismo que te
              cobraremos mañana.
            </p>
          </article>
          <article className="card">
            <h3>Pagos y comprobantes</h3>
            <p>
              Registramos el pago (simulado), pasamos la cuenta a pagada y
              emitimos un comprobante con consecutivo, que tu cliente puede
              verificar en esta página.
            </p>
          </article>
          <article className="card">
            <h3>Habla como hablas</h3>
            <p>
              «Cóbrale a la cédula 1032456789 un cambio de aceite de 80.000, pagó
              en efectivo». La IA solo entiende la frase; el código decide y
              guarda.
            </p>
          </article>
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
    </>
  );
}

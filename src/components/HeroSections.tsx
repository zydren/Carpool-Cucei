const HeroSection = () => {
  return (
    <section className="relative overflow-hidden bg-slate-900 text-white pt-24 pb-16 md:pt-32 md:pb-24">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -top-32 -right-24 h-96 w-96 rounded-full bg-teal-500/20 blur-3xl" />
        <div className="absolute -bottom-40 -left-24 h-96 w-96 rounded-full bg-teal-700/30 blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
      </div>
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-teal-500">
            Movilidad universitaria · CUCEI
          </p>
          <h1 className="mt-5 text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight">
            Tu movilidad universitaria, más simple.
          </h1>
          <p className="mt-5 text-lg md:text-xl text-slate-300 max-w-2xl">
            Encuentra o comparte viajes hacia CUCEI con estudiantes verificados.
            Ahorra, viaja seguro y llega a tiempo.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <a
              href="/buscar-viaje"
              className="inline-flex items-center justify-center rounded-xl bg-white px-6 py-3 text-base font-semibold text-slate-950 hover:bg-teal-500 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              Buscar viaje
            </a>
            <a
              href="/ofrecer-viaje"
              className="inline-flex items-center justify-center rounded-xl border border-white/25 px-6 py-3 text-base font-semibold text-white hover:bg-white/10 hover:border-teal-500 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              Ofrecer viaje
            </a>
          </div>
          <dl className="mt-10 grid max-w-xl grid-cols-3 gap-6">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-widest text-slate-400">Comunidad</dt>
              <dd className="mt-1 text-2xl font-extrabold">CUCEI</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-widest text-slate-400">Enfoque</dt>
              <dd className="mt-1 text-2xl font-extrabold">Seguro</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-widest text-slate-400">Precio</dt>
              <dd className="mt-1 text-2xl font-extrabold">Gratis</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;

const HeroSection = () => {
  return (
    <section className="bg-gradient-to-br from-indigo-600 via-purple-600 to-indigo-800 text-white pt-24 pb-16 md:pt-32 md:pb-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
            Viaja seguro, ahorra dinero y haz nuevos amigos
          </h1>
          <p className="text-xl md:text-2xl mb-8 text-indigo-100 max-w-3xl mx-auto">
            La plataforma de carpool diseñada exclusivamente para estudiantes universitarios. 
            Comparte tus viajes y reduce tus costos de transporte.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button className="bg-white text-indigo-600 hover:bg-indigo-50 font-semibold py-4 px-8 rounded-lg text-lg transition-all transform hover:scale-105 shadow-lg">
              Buscar viaje
            </button>
            <button className="bg-transparent border-2 border-white text-white hover:bg-white hover:text-indigo-600 font-semibold py-4 px-8 rounded-lg text-lg transition-all transform hover:scale-105">
              Ofrecer viaje
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;

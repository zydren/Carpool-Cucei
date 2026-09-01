import Navbar from './components/Navbar';
import HeroSection from './components/HeroSections';
import HowItWorks from './components/HowItWorks';
import Benefits from './components/Benefits';
import Footer from './components/Footer';

function App() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <HeroSection />
      <HowItWorks />
      <Benefits />
      <Footer />
    </div>
  );
}

export default App;

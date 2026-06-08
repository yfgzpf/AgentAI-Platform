import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import logoImage from '/logo.png'

interface SplashScreenProps {
  onComplete: () => void
}

export default function SplashScreen({ onComplete }: SplashScreenProps) {
  const [phase, setPhase] = useState<'feather' | 'logo' | 'slogan' | 'complete'>('feather')

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase('logo'), 1500),
      setTimeout(() => setPhase('slogan'), 2500),
      setTimeout(() => setPhase('complete'), 4000),
      setTimeout(() => onComplete(), 4500),
    ]

    return () => timers.forEach(clearTimeout)
  }, [onComplete])

  const featherVariants = {
    initial: { y: -100, opacity: 0, rotate: -30 },
    animate: {
      y: 0,
      opacity: 1,
      rotate: 0,
      transition: {
        duration: 1.5,
        ease: 'easeOut',
      },
    },
    exit: {
      scale: 0.8,
      opacity: 0,
      transition: { duration: 0.5 },
    },
  }

  const logoVariants = {
    initial: { scale: 0.8, opacity: 0 },
    animate: {
      scale: 1,
      opacity: 1,
      transition: {
        duration: 0.8,
        ease: 'easeOut',
      },
    },
  }

  const sloganVariants = {
    initial: { y: 20, opacity: 0 },
    animate: {
      y: 0,
      opacity: 1,
      transition: {
        duration: 0.6,
        ease: 'easeOut',
      },
    },
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460] flex flex-col items-center justify-center overflow-hidden"
    >
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(20)].map((_, i) => (
          <motion.div
            key={i}
            initial={{
              x: Math.random() * window.innerWidth,
              y: -50,
              rotate: Math.random() * 360,
              opacity: 0.3,
            }}
            animate={{
              y: window.innerHeight + 100,
              x: `+=${Math.random() * 200 - 100}`,
              rotate: `+=${Math.random() * 720}`,
              opacity: [0.3, 0.5, 0.3],
            }}
            transition={{
              duration: 5 + Math.random() * 5,
              repeat: Infinity,
              delay: Math.random() * 3,
              ease: 'linear',
            }}
            className="absolute text-2xl"
            style={{ color: i % 2 === 0 ? '#5A67D8' : '#F687B3' }}
          >
            ✦
          </motion.div>
        ))}
      </div>

      <div className="relative z-10 flex flex-col items-center">
        <AnimatePresence mode="wait">
          {phase === 'feather' && (
            <motion.div
              key="feather"
              variants={featherVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="relative"
            >
              <img 
                src={logoImage} 
                alt="智 Y.Ai Logo" 
                className="w-32 h-32 object-contain"
              />
            </motion.div>
          )}

          {(phase === 'logo' || phase === 'slogan' || phase === 'complete') && (
            <motion.div
              key="logo"
              variants={logoVariants}
              initial="initial"
              animate="animate"
              className="flex flex-col items-center"
            >
              <div className="flex items-center gap-3 mb-4">
                <img 
                  src={logoImage} 
                  alt="智 Y.Ai Logo" 
                  className="w-16 h-16 object-contain"
                />
                <h1 className="text-5xl font-bold bg-gradient-to-r from-[#5A67D8] to-[#F687B3] bg-clip-text text-transparent">
                  智 Y.Ai
                </h1>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {phase === 'slogan' && (
            <motion.p
              key="slogan"
              variants={sloganVariants}
              initial="initial"
              animate="animate"
              className="text-white/80 text-xl mt-4 tracking-widest"
            >
              羽你同行
            </motion.p>
          )}
        </AnimatePresence>

        {phase === 'complete' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-8"
          >
            <div className="w-48 h-1 bg-white/20 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: '0%' }}
                animate={{ width: '100%' }}
                transition={{ duration: 0.5 }}
                className="h-full bg-gradient-to-r from-[#5A67D8] to-[#F687B3]"
              />
            </div>
          </motion.div>
        )}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="absolute bottom-8 text-white/50 text-sm"
      >
        © 2026 智 Y.Ai · Your AI, Your Power
      </motion.div>
    </motion.div>
  )
}

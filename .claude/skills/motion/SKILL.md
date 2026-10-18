---
name: motion
description: A template-based agent for generating Motion (React) code snippets and solutions. Use this skill when you need to create animations, handle gestures, set up Motion in React applications, or implement advanced Motion features.
---

# Motion Agent Skill

A template-based agent for generating Motion (React) code snippets and solutions. Use this skill when you need to create animations, handle gestures, set up Motion in React applications, or implement advanced Motion features.

## Installation & Setup

**Install Motion via npm:**
```bash
npm install motion
```

**Import Motion in React:**
```javascript
import { motion } from "motion/react"
```

**Install Motion via Yarn:**
```bash
yarn add motion
```

**Install Motion via pnpm:**
```bash
pnpm add motion
```

**Use Motion in Next.js App Router:**
```javascript
"use client"

import { motion } from "motion/react"

export default function MyComponent() {
  return <motion.div animate={{ scale: 1.5 }} />
}
```

**Optimize Motion import for Next.js App Router:**
```javascript
import * as motion from "motion/react-client"

export default function MyComponent() {
  return <motion.div animate={{ scale: 1.5 }} />
}
```

**Add Motion via CDN (jsDelivr):**
```html
<script type="module">
  import motion from "https://cdn.jsdelivr.net/npm/motion@12.23.12/react/+esm"
</script>
```

## Basic Animations

**Create a basic animated button:**
```javascript
import { motion } from "motion/react"

function Component() {
  return <motion.button animate={{ opacity: 1 }} />
}
```

**Enter animation with initial and animate props:**
```javascript
<motion.button initial={{ scale: 0 }} animate={{ scale: 1 }} />
```

**Configure animation duration:**
```javascript
<motion.div
  animate={{
    scale: 2,
    transition: { duration: 2 }
  }}
/>
```

**Disable initial animation:**
```javascript
<motion.button initial={false} animate={{ scale: 1 }} />
```

**Scroll-triggered Animation with whileInView:**
```javascript
<motion.div
  initial={{ backgroundColor: "rgb(0, 255, 0)", opacity: 0 }}
  whileInView={{ backgroundColor: "rgb(255, 0, 0)", opacity: 1 }}
/>
```

## Gestures & Interactions

**Hover and tap gestures:**
```javascript
import { motion } from "motion/react";

const AnimatedButton = () => {
  return (
    <motion.button
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.9 }}
      transition={{ duration: 0.2 }}
    >
      Hover and Tap Me
    </motion.button>
  );
};

export default AnimatedButton;
```

**Handle hover start with element and event data:**
```javascript
hover("div:nth-child(2)", (element, startEvent) => {
  console.log("Hover started on", element)
  console.log("At", startEvent.clientX, startEvent.clientY)
})
```

**Handle hover start and end events:**
```javascript
hover("a", () => {
  console.log("hover start")
  
  return (endEvent) => {
    console.log("hover end")
  }
})
```

**Press start events:**
```javascript
press("button", (element) => {
  console.log("press started on", element)
  
  return () => console.log("press ended")
})
```

**Tap start events:**
```javascript
<motion.div onTapStart={(event) => console.log(event)} />
```

**Pan start events:**
```javascript
<motion.div onPanStart={(event, info) => console.log(info.delta.x)} />
```

**Drag from custom element:**
```javascript
<div onPointerDown={event => controls.start(event)} />
```

## Advanced Features

**Motion Values:**
```javascript
import { motionValue } from "motion"

const x = motionValue(0)

// Get velocity
const velocity = x.getVelocity()

// Subscribe to changes
x.on("change", latest => console.log(latest))

// Set string value (e.g., color)
x.set("#f00")

// Manual creation and animation
const x = motionValue(0)
x.on("change", latest => console.log(latest))
animate(x, 100)
```

**Spring animations:**
```javascript
import { spring } from "motion"

// Basic spring
spring({ keyframes: [0, 100] })

// Spring generator
const generator = spring({ keyframes: [0, 100] })
generator.next(100)
generator.next(10)

// Non-linear sampling
generator.next(100)
generator.next(10)
```

**useTime and useTransform for continuous animation:**
```javascript
const time = useTime()
const rotate = useTransform(
  time,
  [0, 4000], // For every 4 seconds...
  [0, 360], // ...rotate 360deg
  { clamp: false }
)

// Perpetual rotation
<motion.div style={{ rotate }} />
```

**Scroll-linked Animation with useScroll:**
```javascript
const { scrollYProgress } = useScroll()
return <motion.div style={{ scaleX: scrollYProgress }} />
```

**Stagger Child Animations:**
```javascript
const transition = {
  delayChildren: stagger(0.1, { from: "last" })
}
```

**Animation Delay Parameter:**
```javascript
animate(element, { filter: "blur(10px)" }, { delay: 0.3 })
```

**Value-Specific Transitions:**
```javascript
<motion.li
  :animate="{
    x: 0,
    opacity: 1,
    transition: {
      default: { type: 'spring' },
      opacity: { ease: 'linear' }
    }
  }"
/>
```

```javascript
animate("li", { x: 0, opacity: 1 }, {
  default: { type: "spring" },
  opacity: { ease: "linear" }
})
```

**Layout Animation:**
```javascript
<motion.div layout />
```

**Shared Element Animation:**
```javascript
<motion.div layoutId="underline" />
```

**Exit Animation with AnimatePresence:**
```javascript
<AnimatePresence>
  {show ? <motion.div key="box" exit={{ opacity: 0 }} /> : null}
</AnimatePresence>
```

**Create Exit Animations with useAnimate and usePresence:**
```javascript
import { useAnimate, usePresence } from "motion/react"

function Component() {
  const [isPresent, safeToRemove] = usePresence()
  const [scope, animate] = useAnimate()
   
  useEffect(() => {
     if (isPresent) {
       const enterAnimation = async () => {
         await animate(scope.current, { opacity: 1 })
         await animate("li", { opacity: 1, x: 0 })
       }
       enterAnimation()
     } else {
       const exitAnimation = async () => {
         await animate("li", { opacity: 0, x: -100 })
         await animate(scope.current, { opacity: 0 })
         safeToRemove()
       }
       exitAnimation()
     }
  }, [isPresent])
   
  return (
    <ul ref={scope}>
      <li />
      <li />
      <li />
    </ul>
  )
}
```

```javascript
<AnimatePresence>
  {show ? <Component key="dialog" /> : null}
</AnimatePresence>
```

**MotionConfig for global transitions:**
```javascript
import { motion, MotionConfig } from "motion/react"

export const MyComponent = ({ isVisible }) => (
  <MotionConfig transition={{ duration: 1 }}>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    />
  </MotionConfig>
)
```

**LazyMotion setup:**
```javascript
import { LazyMotion, domAnimation } from "motion/react"

function App({ children }) {
  return (
    <LazyMotion features={domAnimation}>
      {children}
    </LazyMotion>
  )
}
```

**Asynchronous LazyMotion loading:**
```javascript
// features.js
import { domAnimation } from "motion/react"
export default domAnimation

// index.js
const loadFeatures = () => import("./features.js")
  .then(res => res.default)

function Component() {
  return (
    <LazyMotion features={loadFeatures}>
      <m.div animate={{ scale: 1.5 }} />
    </LazyMotion>
  )
}
```

**UseMotionTemplate (React):**
```javascript
const x = useMotionValue(100)
const transform = useMotionTemplate`transform(${x}px)`
```

**Easing Functions:**
```javascript
import { cubicBezier, easeIn, steps } from "motion"

const easing = cubicBezier(.35,.17,.3,.86)
const easedProgress = easing(0.5)

const stepsEasing = steps(4, "start")
stepsEasing(0.2) // 0.25
```

**SVG Path Animation:**
```javascript
<motion.circle animate={{ pathLength: 1 }} />
```

**Motion Value Events:**
```javascript
function Component() {
  const x = useMotionValue(0)
   
  useMotionValueEvent(x, "animationStart", () => {
    console.log("animation started on x")
  })
   
  useMotionValueEvent(x, "change", (latest) => {
    console.log("x changed to", latest)
  })
   
  return <motion.div style={{ x }} />
}
```

**Frame callbacks:**
```javascript
import { delay, frame } from "motion"

delay(() => {
  const { left } = element.getBoundingClientRect()
  
  // Will render later during this animation frame
  frame.render(() => {
    element.style.left = `${left * 2}px`
  })
}, 1)

// Continuous animation loop
let i = 0

function update() {
  i++
  
  // Stop after 100 frames
  if (i >= 100) cancelFrame(update)
}

frame.update(update, true)

// Render callback
frame.render(() => element.style.transform = "translateX(0px)")
```

**Migration from framer-motion to motion:**
```bash
npm uninstall framer-motion
npm install motion
```

```javascript
import { motion } from "motion/react"
```

**Layout Animation Migration (Motion 1 to Motion 2):**
```jsx
// Before (Motion 1)
<motion.div layoutTransition />

// After (Motion 2)
<motion.div layout />
```

```jsx
// Before (Motion 1)
<motion.div layoutTransition={{ duration: 2 }} />

// After (Motion 2)
<motion.div layout transition={{ duration: 2 }} />
```

**Animation Sequencing:**
```javascript
const sequence = [
  ["nav", { opacity: 1 }],
  
  // 0.5 seconds after the start animation
  ["nav", { x: 100 }, { at: "<0.5" }],
  
  // 0.2 seconds before the start of the previous animation
  ["nav li", { opacity: 1 }, { at: "<-0.2" }],
]

// Start at same time as previous segment
const sequence = [
  ["nav", { x: 100 }, { duration: 1 }],
  ["li", { opacity: 1 }, { at: "<" }],
]
```

**AnimateNumber Examples:**

**Basic spring transition:**
```jsx
<AnimateNumber transition={{ type: "spring" }}>
  {count}
</AnimateNumber>
```

**Advanced transition settings:**
```jsx
<AnimateNumber transition={{
  layout: { duration: 0.3 },
  opacity: { ease: "linear" },
  y: { type: "spring", visualDuration: 0.4, bounce: 0.2 }
}}>
  {count}
</AnimateNumber>
```

**Dynamic counter:**
```jsx
import { AnimateNumber } from "motion-plus/react"

function Counter() {
  const [count, setCount] = useState(0)

  return (
    <>
      <button onClick={() => setCount(count + 1)}>Increment</button>
      <AnimateNumber>{count}</AnimateNumber>
    </>
  )
}
```

**Motion.js for Squarespace (Full):**
```html
<script type="module" defer>
    import { animate } from "https://cdn.jsdelivr.net/npm/motion@11.13.5/+esm"
    
    // Your animation code here
    animate("h1", { opacity: [0, 1] })
</script>
```

**Motion.js for Squarespace (Mini):**
```html
<script type="module" defer>
    import { animate } from "https://cdn.jsdelivr.net/npm/motion@11.13.5/mini/+esm"
    
    // Your animation code here
    animate("h1", { opacity: [0, 1] })
</script>
```
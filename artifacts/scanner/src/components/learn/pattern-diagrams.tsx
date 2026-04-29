import React from "react";

const VBOX_W = 240;
const VBOX_H = 110;

const Frame = ({ children }: { children: React.ReactNode }) => (
  <svg
    viewBox={`0 0 ${VBOX_W} ${VBOX_H}`}
    className="w-full max-w-[280px] h-28 rounded border border-border bg-card/40"
    preserveAspectRatio="xMidYMid meet"
    role="img"
  >
    {children}
  </svg>
);

const flip = (price: number) => VBOX_H - price;

type CandleDef = {
  x: number;
  o: number;
  c: number;
  h: number;
  l: number;
  w?: number;
};

const Candle = ({ x, o, c, h, l, w = 12 }: CandleDef) => {
  const bull = c >= o;
  const stroke = bull ? "#22c55e" : "#ef4444";
  const fill = bull ? "#22c55e" : "#ef4444";
  const yo = flip(o);
  const yc = flip(c);
  const yh = flip(h);
  const yl = flip(l);
  const bodyTop = Math.min(yo, yc);
  const bodyBottom = Math.max(yo, yc);
  const cx = x + w / 2;
  const bodyHeight = Math.max(2, bodyBottom - bodyTop);
  return (
    <g>
      <line x1={cx} y1={yh} x2={cx} y2={yl} stroke={stroke} strokeWidth={1.4} />
      <rect x={x} y={bodyTop} width={w} height={bodyHeight} fill={fill} stroke={stroke} strokeWidth={0.5} />
    </g>
  );
};

// ───────────────────────────── Candlestick patterns ─────────────────────────────

const Doji = () => (
  <Frame>
    <Candle x={114} o={55} c={56} h={88} l={22} w={12} />
  </Frame>
);

const Hammer = () => (
  <Frame>
    <Candle x={70} o={75} c={70} h={78} l={66} />
    <Candle x={90} o={68} c={62} h={70} l={58} />
    <Candle x={110} o={60} c={56} h={62} l={52} />
    <Candle x={140} o={62} c={68} h={70} l={20} />
  </Frame>
);

const InvertedHammer = () => (
  <Frame>
    <Candle x={70} o={75} c={70} h={78} l={66} />
    <Candle x={90} o={68} c={62} h={70} l={58} />
    <Candle x={110} o={60} c={56} h={62} l={52} />
    <Candle x={140} o={56} c={62} h={96} l={54} />
  </Frame>
);

const ShootingStar = () => (
  <Frame>
    <Candle x={70} o={28} c={36} h={40} l={26} />
    <Candle x={90} o={36} c={48} h={52} l={34} />
    <Candle x={110} o={48} c={62} h={66} l={46} />
    <Candle x={140} o={62} c={56} h={96} l={54} />
  </Frame>
);

const HangingMan = () => (
  <Frame>
    <Candle x={70} o={28} c={36} h={40} l={26} />
    <Candle x={90} o={36} c={48} h={52} l={34} />
    <Candle x={110} o={48} c={62} h={66} l={46} />
    <Candle x={140} o={70} c={64} h={72} l={20} />
  </Frame>
);

const BullishMarubozu = () => (
  <Frame>
    <Candle x={114} o={28} c={88} h={88} l={28} w={14} />
  </Frame>
);

const BearishMarubozu = () => (
  <Frame>
    <Candle x={114} o={88} c={28} h={88} l={28} w={14} />
  </Frame>
);

const SpinningTop = () => (
  <Frame>
    <Candle x={114} o={50} c={62} h={92} l={20} w={12} />
  </Frame>
);

const DragonflyDoji = () => (
  <Frame>
    <Candle x={114} o={84} c={86} h={88} l={20} w={12} />
  </Frame>
);

const GravestoneDoji = () => (
  <Frame>
    <Candle x={114} o={28} c={26} h={92} l={24} w={12} />
  </Frame>
);

const BullishEngulfing = () => (
  <Frame>
    <Candle x={70} o={70} c={62} h={74} l={58} />
    <Candle x={92} o={66} c={56} h={68} l={52} />
    <Candle x={120} o={48} c={84} h={88} l={44} w={16} />
  </Frame>
);

const BearishEngulfing = () => (
  <Frame>
    <Candle x={70} o={36} c={44} h={48} l={32} />
    <Candle x={92} o={44} c={56} h={60} l={42} />
    <Candle x={120} o={62} c={28} h={68} l={24} w={16} />
  </Frame>
);

const PiercingLine = () => (
  <Frame>
    <Candle x={92} o={78} c={36} h={82} l={32} w={14} />
    <Candle x={120} o={28} c={64} h={68} l={24} w={14} />
    <line x1={86} y1={flip(57)} x2={140} y2={flip(57)} stroke="#888" strokeWidth={0.6} strokeDasharray="3 2" />
  </Frame>
);

const DarkCloudCover = () => (
  <Frame>
    <Candle x={92} o={36} c={78} h={82} l={32} w={14} />
    <Candle x={120} o={88} c={50} h={92} l={46} w={14} />
    <line x1={86} y1={flip(57)} x2={140} y2={flip(57)} stroke="#888" strokeWidth={0.6} strokeDasharray="3 2" />
  </Frame>
);

const BullishHarami = () => (
  <Frame>
    <Candle x={92} o={78} c={32} h={82} l={28} w={14} />
    <Candle x={120} o={50} c={64} h={68} l={46} w={10} />
  </Frame>
);

const BearishHarami = () => (
  <Frame>
    <Candle x={92} o={32} c={78} h={82} l={28} w={14} />
    <Candle x={120} o={64} c={50} h={68} l={46} w={10} />
  </Frame>
);

const TweezerBottom = () => (
  <Frame>
    <Candle x={92} o={50} c={28} h={54} l={20} w={14} />
    <Candle x={120} o={28} c={56} h={60} l={20} w={14} />
    <line x1={84} y1={flip(20)} x2={146} y2={flip(20)} stroke="#888" strokeDasharray="3 2" strokeWidth={0.6} />
  </Frame>
);

const TweezerTop = () => (
  <Frame>
    <Candle x={92} o={56} c={84} h={92} l={52} w={14} />
    <Candle x={120} o={84} c={56} h={92} l={52} w={14} />
    <line x1={84} y1={flip(92)} x2={146} y2={flip(92)} stroke="#888" strokeDasharray="3 2" strokeWidth={0.6} />
  </Frame>
);

const MorningStar = () => (
  <Frame>
    <Candle x={70} o={80} c={42} h={84} l={38} w={14} />
    <Candle x={100} o={32} c={30} h={36} l={26} w={10} />
    <Candle x={130} o={42} c={80} h={84} l={38} w={14} />
  </Frame>
);

const EveningStar = () => (
  <Frame>
    <Candle x={70} o={30} c={68} h={72} l={26} w={14} />
    <Candle x={100} o={78} c={80} h={84} l={74} w={10} />
    <Candle x={130} o={68} c={30} h={72} l={26} w={14} />
  </Frame>
);

const ThreeWhiteSoldiers = () => (
  <Frame>
    <Candle x={70} o={28} c={50} h={52} l={26} w={14} />
    <Candle x={100} o={42} c={68} h={70} l={40} w={14} />
    <Candle x={130} o={60} c={86} h={88} l={58} w={14} />
  </Frame>
);

const ThreeBlackCrows = () => (
  <Frame>
    <Candle x={70} o={86} c={62} h={88} l={60} w={14} />
    <Candle x={100} o={70} c={44} h={72} l={42} w={14} />
    <Candle x={130} o={50} c={26} h={52} l={24} w={14} />
  </Frame>
);

const RisingThreeMethods = () => (
  <Frame>
    <Candle x={48} o={28} c={78} h={82} l={26} w={14} />
    <Candle x={78} o={68} c={58} h={70} l={56} w={8} />
    <Candle x={100} o={60} c={52} h={62} l={50} w={8} />
    <Candle x={122} o={56} c={48} h={58} l={46} w={8} />
    <Candle x={150} o={48} c={92} h={94} l={46} w={14} />
  </Frame>
);

const FallingThreeMethods = () => (
  <Frame>
    <Candle x={48} o={88} c={32} h={92} l={28} w={14} />
    <Candle x={78} o={42} c={50} h={52} l={40} w={8} />
    <Candle x={100} o={50} c={58} h={60} l={48} w={8} />
    <Candle x={122} o={56} c={64} h={66} l={54} w={8} />
    <Candle x={150} o={62} c={20} h={66} l={18} w={14} />
  </Frame>
);

const Kicker = () => (
  <Frame>
    <Candle x={80} o={70} c={44} h={74} l={40} w={16} />
    <Candle x={130} o={68} c={94} h={96} l={66} w={16} />
    <text x={104} y={flip(58)} fontSize="9" fill="#888">gap</text>
  </Frame>
);

// ───────────────────────────── Chart pattern primitives ─────────────────────────────

const Path = ({ d, stroke = "#60a5fa" }: { d: string; stroke?: string }) => (
  <path d={d} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
);

const DashedLine = ({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) => (
  <line x1={x1} y1={flip(y1)} x2={x2} y2={flip(y2)} stroke="#94a3b8" strokeWidth={0.7} strokeDasharray="3 2" />
);

const Label = ({ x, y, text }: { x: number; y: number; text: string }) => (
  <text x={x} y={flip(y)} fontSize="8" fill="#94a3b8" textAnchor="middle">
    {text}
  </text>
);

const linePath = (pts: Array<[number, number]>) =>
  pts.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${flip(y)}`).join(" ");

// ───────────────────────────── Chart patterns ─────────────────────────────

const HeadAndShoulders = () => (
  <Frame>
    <Path d={linePath([[20, 30], [50, 50], [75, 35], [105, 75], [135, 35], [165, 65], [190, 30], [220, 18]])} />
    <DashedLine x1={50} y1={35} x2={190} y2={35} />
    <Label x={75} y={82} text="LS" />
    <Label x={135} y={45} text="RS" />
    <Label x={105} y={82} text="Head" />
  </Frame>
);

const InverseHeadAndShoulders = () => (
  <Frame>
    <Path d={linePath([[20, 80], [50, 60], [75, 75], [105, 35], [135, 75], [165, 45], [190, 80], [220, 92]])} />
    <DashedLine x1={50} y1={75} x2={190} y2={75} />
    <Label x={75} y={28} text="LS" />
    <Label x={135} y={65} text="RS" />
    <Label x={105} y={28} text="Head" />
  </Frame>
);

const DoubleTop = () => (
  <Frame>
    <Path d={linePath([[20, 30], [60, 80], [110, 50], [150, 80], [200, 30], [225, 18]])} />
    <DashedLine x1={60} y1={80} x2={200} y2={80} />
  </Frame>
);

const DoubleBottom = () => (
  <Frame>
    <Path d={linePath([[20, 80], [60, 30], [110, 60], [150, 30], [200, 80], [225, 92]])} />
    <DashedLine x1={60} y1={30} x2={200} y2={30} />
  </Frame>
);

const TripleTop = () => (
  <Frame>
    <Path d={linePath([[15, 30], [50, 78], [85, 50], [120, 78], [155, 50], [190, 78], [220, 25]])} />
    <DashedLine x1={50} y1={78} x2={190} y2={78} />
  </Frame>
);

const TripleBottom = () => (
  <Frame>
    <Path d={linePath([[15, 80], [50, 32], [85, 60], [120, 32], [155, 60], [190, 32], [220, 88]])} />
    <DashedLine x1={50} y1={32} x2={190} y2={32} />
  </Frame>
);

const RoundingBottom = () => (
  <Frame>
    <Path d={`M 20 ${flip(80)} Q 120 ${flip(15)} 220 ${flip(80)}`} />
    <DashedLine x1={20} y1={80} x2={220} y2={80} />
  </Frame>
);

const RoundingTop = () => (
  <Frame>
    <Path d={`M 20 ${flip(30)} Q 120 ${flip(95)} 220 ${flip(30)}`} />
    <DashedLine x1={20} y1={30} x2={220} y2={30} />
  </Frame>
);

const CupAndHandle = () => (
  <Frame>
    <Path d={`M 15 ${flip(78)} Q 95 ${flip(20)} 175 ${flip(78)} L 195 ${flip(60)} L 215 ${flip(80)} L 230 ${flip(95)}`} />
    <DashedLine x1={15} y1={78} x2={215} y2={78} />
  </Frame>
);

const InverseCupAndHandle = () => (
  <Frame>
    <Path d={`M 15 ${flip(32)} Q 95 ${flip(90)} 175 ${flip(32)} L 195 ${flip(50)} L 215 ${flip(30)} L 230 ${flip(15)}`} />
    <DashedLine x1={15} y1={32} x2={215} y2={32} />
  </Frame>
);

const BullFlag = () => (
  <Frame>
    <Path d={linePath([[15, 20], [50, 90]])} />
    <Path d={linePath([[50, 90], [80, 75], [110, 85], [140, 70], [170, 80]])} />
    <Path d={linePath([[170, 80], [220, 95]])} stroke="#22c55e" />
    <DashedLine x1={50} y1={90} x2={170} y2={80} />
    <DashedLine x1={80} y1={75} x2={170} y2={65} />
  </Frame>
);

const BearFlag = () => (
  <Frame>
    <Path d={linePath([[15, 90], [50, 20]])} />
    <Path d={linePath([[50, 20], [80, 35], [110, 25], [140, 40], [170, 30]])} />
    <Path d={linePath([[170, 30], [220, 15]])} stroke="#ef4444" />
    <DashedLine x1={50} y1={20} x2={170} y2={30} />
    <DashedLine x1={80} y1={35} x2={170} y2={45} />
  </Frame>
);

const BullishPennant = () => (
  <Frame>
    <Path d={linePath([[15, 20], [50, 90]])} />
    <Path d={linePath([[50, 90], [85, 60], [115, 80], [145, 70], [170, 75]])} />
    <Path d={linePath([[170, 75], [220, 95]])} stroke="#22c55e" />
    <DashedLine x1={50} y1={90} x2={170} y2={75} />
    <DashedLine x1={50} y1={45} x2={170} y2={75} />
  </Frame>
);

const BearishPennant = () => (
  <Frame>
    <Path d={linePath([[15, 90], [50, 20]])} />
    <Path d={linePath([[50, 20], [85, 50], [115, 30], [145, 40], [170, 35]])} />
    <Path d={linePath([[170, 35], [220, 15]])} stroke="#ef4444" />
    <DashedLine x1={50} y1={20} x2={170} y2={35} />
    <DashedLine x1={50} y1={65} x2={170} y2={35} />
  </Frame>
);

const AscendingTriangle = () => (
  <Frame>
    <Path d={linePath([[20, 35], [55, 78], [90, 50], [125, 78], [160, 60], [195, 78], [225, 95]])} />
    <DashedLine x1={20} y1={78} x2={225} y2={78} />
    <DashedLine x1={20} y1={35} x2={225} y2={78} />
  </Frame>
);

const DescendingTriangle = () => (
  <Frame>
    <Path d={linePath([[20, 75], [55, 32], [90, 60], [125, 32], [160, 50], [195, 32], [225, 15]])} />
    <DashedLine x1={20} y1={32} x2={225} y2={32} />
    <DashedLine x1={20} y1={75} x2={225} y2={32} />
  </Frame>
);

const SymmetricalTriangle = () => (
  <Frame>
    <Path d={linePath([[20, 80], [55, 25], [90, 65], [125, 35], [160, 55], [195, 45], [225, 78]])} />
    <DashedLine x1={20} y1={25} x2={225} y2={50} />
    <DashedLine x1={20} y1={80} x2={225} y2={50} />
  </Frame>
);

const Rectangle = () => (
  <Frame>
    <Path d={linePath([[15, 30], [40, 78], [70, 32], [100, 78], [130, 32], [160, 78], [190, 32], [220, 95]])} />
    <DashedLine x1={15} y1={78} x2={220} y2={78} />
    <DashedLine x1={15} y1={32} x2={220} y2={32} />
  </Frame>
);

const RisingWedge = () => (
  <Frame>
    <Path d={linePath([[15, 30], [50, 70], [85, 45], [120, 78], [155, 60], [190, 80], [225, 25]])} />
    <DashedLine x1={15} y1={30} x2={225} y2={85} />
    <DashedLine x1={15} y1={20} x2={225} y2={80} />
  </Frame>
);

const FallingWedge = () => (
  <Frame>
    <Path d={linePath([[15, 80], [50, 40], [85, 65], [120, 32], [155, 50], [190, 30], [225, 85]])} />
    <DashedLine x1={15} y1={80} x2={225} y2={25} />
    <DashedLine x1={15} y1={90} x2={225} y2={30} />
  </Frame>
);

const DiamondTop = () => (
  <Frame>
    <Path d={linePath([[15, 50], [55, 85], [90, 30], [125, 90], [160, 25], [195, 80], [220, 30], [230, 15]])} />
    <DashedLine x1={15} y1={50} x2={120} y2={92} />
    <DashedLine x1={15} y1={50} x2={120} y2={20} />
    <DashedLine x1={120} y1={92} x2={225} y2={50} />
    <DashedLine x1={120} y1={20} x2={225} y2={50} />
  </Frame>
);

const BroadeningFormation = () => (
  <Frame>
    <Path d={linePath([[15, 50], [55, 75], [90, 35], [125, 85], [160, 25], [195, 90], [225, 18]])} />
    <DashedLine x1={15} y1={55} x2={225} y2={18} />
    <DashedLine x1={15} y1={45} x2={225} y2={92} />
  </Frame>
);

const BumpAndRunReversal = () => (
  <Frame>
    <Path d={linePath([[15, 30], [50, 40], [85, 55], [120, 85], [155, 65], [190, 35], [225, 15]])} />
    <DashedLine x1={15} y1={28} x2={225} y2={75} />
  </Frame>
);

const ABCDPattern = () => (
  <Frame>
    <Path d={linePath([[20, 80], [80, 30], [130, 55], [190, 15]])} />
    <Label x={20} y={88} text="A" />
    <Label x={80} y={22} text="B" />
    <Label x={130} y={47} text="C" />
    <Label x={190} y={7} text="D" />
  </Frame>
);

const Gartley = () => (
  <Frame>
    <Path d={linePath([[15, 90], [60, 25], [105, 55], [150, 35], [200, 80]])} />
    <Label x={15} y={98} text="X" />
    <Label x={60} y={17} text="A" />
    <Label x={105} y={47} text="B" />
    <Label x={150} y={27} text="C" />
    <Label x={200} y={88} text="D" />
  </Frame>
);

// ───────────────────────────── Lookup map ─────────────────────────────

const REGISTRY: Record<string, React.ComponentType> = {
  // candlestick
  doji: Doji,
  hammer: Hammer,
  "inverted-hammer": InvertedHammer,
  "shooting-star": ShootingStar,
  "hanging-man": HangingMan,
  "bullish-marubozu": BullishMarubozu,
  "bearish-marubozu": BearishMarubozu,
  "spinning-top": SpinningTop,
  "dragonfly-doji": DragonflyDoji,
  "gravestone-doji": GravestoneDoji,
  "bullish-engulfing": BullishEngulfing,
  "bearish-engulfing": BearishEngulfing,
  "piercing-line": PiercingLine,
  "dark-cloud-cover": DarkCloudCover,
  "bullish-harami": BullishHarami,
  "bearish-harami": BearishHarami,
  "tweezer-bottom": TweezerBottom,
  "tweezer-top": TweezerTop,
  "morning-star": MorningStar,
  "evening-star": EveningStar,
  "three-white-soldiers": ThreeWhiteSoldiers,
  "three-black-crows": ThreeBlackCrows,
  "rising-three-methods": RisingThreeMethods,
  "falling-three-methods": FallingThreeMethods,
  kicker: Kicker,
  // chart
  "head-and-shoulders": HeadAndShoulders,
  "inverse-head-and-shoulders": InverseHeadAndShoulders,
  "double-top": DoubleTop,
  "double-bottom": DoubleBottom,
  "triple-top": TripleTop,
  "triple-bottom": TripleBottom,
  "rounding-bottom": RoundingBottom,
  "rounding-top": RoundingTop,
  "cup-and-handle": CupAndHandle,
  "inverse-cup-and-handle": InverseCupAndHandle,
  "bull-flag": BullFlag,
  "bear-flag": BearFlag,
  "bullish-pennant": BullishPennant,
  "bearish-pennant": BearishPennant,
  "ascending-triangle": AscendingTriangle,
  "descending-triangle": DescendingTriangle,
  "symmetrical-triangle": SymmetricalTriangle,
  rectangle: Rectangle,
  "rising-wedge": RisingWedge,
  "falling-wedge": FallingWedge,
  "diamond-top": DiamondTop,
  "broadening-formation": BroadeningFormation,
  "bump-and-run-reversal": BumpAndRunReversal,
  abcd: ABCDPattern,
  gartley: Gartley,
  // Aliases for terms with slash-aliases or numeric suffixes
  "bullish-bearish-kicker": Kicker,
  "rounding-bottom-saucer": RoundingBottom,
  "rectangle-trading-range": Rectangle,
  "broadening-formation-megaphone": BroadeningFormation,
  "bump-and-run-reversal-barr": BumpAndRunReversal,
  "gartley-222": Gartley,
};

const slugToLabel = (slug: string): string =>
  slug
    .split("-")
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");

export const PatternDiagram = ({ slug }: { slug: string }): React.ReactElement | null => {
  const Cmp = REGISTRY[slug];
  if (!Cmp) return null;
  return (
    <div role="img" aria-label={`${slugToLabel(slug)} pattern diagram`}>
      <Cmp />
    </div>
  );
};

export const hasDiagram = (slug: string): boolean => slug in REGISTRY;

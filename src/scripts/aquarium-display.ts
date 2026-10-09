// Portrait system top regions in logical screen pixels. Safari can omit this
// region from the page while reporting zero CSS safe-area insets. Prefer its
// environment values; these are fallbacks for standard iPhone display sizes.
// Native inset measurements: https://cfap.github.io/posts/StatusBar/
// UIKit fallback data: https://github.com/Tencent/QMUI_iOS/blob/master/QMUIKit/QMUICore/QMUIHelper.m
export const iphoneTopInsets: Record<string, number> = {
  '320x480': 20,
  '320x568': 20,
  '375x667': 20,
  '414x736': 20,
  '360x780': 50,
  '375x812': 44,
  '390x844': 47,
  '393x852': 59,
  '402x874': 62,
  '414x896': 44,
  '420x912': 68,
  '428x926': 47,
  '430x932': 59,
  '440x956': 62,
};

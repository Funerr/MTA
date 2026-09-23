/** Midscene 原生框架 2x2 矩阵:模型(由 MIDSCENE_INSIGHT_MODEL_* 决定) x wifi 开关 */
import { execSync } from 'node:child_process';
import { agentFromAdbDevice } from '@midscene/android';

const dev = 'HC10006129200186';
const sh = (c: string) => execSync(c).toString().trim();
const wifiOn = async (on: boolean) => {
  sh(`adb -s ${dev} shell cmd wifi set-wifi-enabled ${on ? 'enabled' : 'disabled'}`);
  await new Promise((r) => setTimeout(r, 2500));
  const s = sh(`adb -s ${dev} shell cmd wifi status`);
  console.log(`  [ground truth] ${s.split('\n')[0]}`);
};

console.log(`== 原生框架矩阵, insight=${process.env.MIDSCENE_INSIGHT_MODEL_NAME || 'default(mimo-v2.5)'} ==`);
const agent = await agentFromAdbDevice(dev);
try {
  for (const on of [false, true]) {
    await wifiOn(on);
    sh(`adb -s ${dev} shell input keyevent KEYCODE_HOME`);
    await new Promise((r) => setTimeout(r, 800));
    sh(`adb -s ${dev} shell input swipe 1050 20 900 1300 400`);
    await new Promise((r) => setTimeout(r, 1500));
    try {
      await agent.aiAssert('当前 WLAN 处于开启状态');
      console.log(`  wifi=${on ? '开启' : '关闭'} => PASS`);
    } catch (e) {
      const msg = String((e as Error).message);
      const reason = msg.split(/Reason:|the result is/)[1]?.trim().slice(0, 160) || msg.slice(0, 160);
      console.log(`  wifi=${on ? '开启' : '关闭'} => FAIL | ${reason}`);
    }
  }
} finally {
  await agent.destroy();
}

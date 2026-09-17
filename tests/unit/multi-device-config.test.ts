import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MULTI_DEVICE_BINDINGS_SPEC,
  MultiDeviceConfigError,
  loadMultiDeviceBindings,
  parseMultiDeviceBindings,
  resolveMultiDeviceTargets,
} from '../../src/setup/multi-device-config';

describe('parseMultiDeviceBindings', () => {
  it('接受至少两台、不同平台组合的合法声明', () => {
    expect(
      parseMultiDeviceBindings(
        'phone1:android:MULTI_DEVICE_PHONE1_ID, phone2:harmony:MULTI_DEVICE_PHONE2_ID',
      ),
    ).toEqual([
      { alias: 'phone1', platform: 'android', idEnv: 'MULTI_DEVICE_PHONE1_ID' },
      { alias: 'phone2', platform: 'harmony', idEnv: 'MULTI_DEVICE_PHONE2_ID' },
    ]);
  });

  it('接受两台同平台设备', () => {
    expect(
      parseMultiDeviceBindings('left:android:LEFT_ID,right:android:RIGHT_ID'),
    ).toHaveLength(2);
  });

  it('少于两台时报错', () => {
    expect(() => parseMultiDeviceBindings('phone1:android:A_ID')).toThrow(
      MultiDeviceConfigError,
    );
    expect(() => parseMultiDeviceBindings('')).toThrow(/至少需要两台/);
  });

  it('拒绝非法别名、保留名与重复别名', () => {
    expect(() =>
      parseMultiDeviceBindings('1phone:android:A,phone2:harmony:B'),
    ).toThrow(/设备别名无效/);
    expect(() =>
      parseMultiDeviceBindings('phone-1:android:A,phone2:harmony:B'),
    ).toThrow(/设备别名无效/);
    expect(() =>
      parseMultiDeviceBindings('device:android:A,phone2:harmony:B'),
    ).toThrow(/保留名/);
    expect(() =>
      parseMultiDeviceBindings('phone1:android:A,phone1:harmony:B'),
    ).toThrow(/别名重复/);
  });

  it('拒绝非法平台、声明格式与环境变量名', () => {
    expect(() =>
      parseMultiDeviceBindings('phone1:ios:A,phone2:android:B'),
    ).toThrow(/平台无效/);
    expect(() => parseMultiDeviceBindings('phone1-android-A,phone2:android:B')).toThrow(
      /格式无效/,
    );
    expect(() =>
      parseMultiDeviceBindings('phone1:android:1ID,phone2:harmony:B'),
    ).toThrow(/环境变量名无效/);
  });
});

describe('loadMultiDeviceBindings / resolveMultiDeviceTargets', () => {
  it('未配置时使用默认两台声明，且不连接设备', () => {
    expect(loadMultiDeviceBindings({})).toEqual(
      parseMultiDeviceBindings(DEFAULT_MULTI_DEVICE_BINDINGS_SPEC),
    );
  });

  it('解析显式设备 ID；缺失或空白 ID 失败', () => {
    const bindings = parseMultiDeviceBindings(
      'phone1:android:A_ID,phone2:harmony:B_ID',
    );
    expect(
      resolveMultiDeviceTargets(bindings, { A_ID: 'emu-1', B_ID: 'har-1' }),
    ).toEqual([
      { alias: 'phone1', platform: 'android', idEnv: 'A_ID', id: 'emu-1' },
      { alias: 'phone2', platform: 'harmony', idEnv: 'B_ID', id: 'har-1' },
    ]);
    expect(() =>
      resolveMultiDeviceTargets(bindings, { A_ID: 'emu-1' }),
    ).toThrow(/phone2.*B_ID/);
    expect(() =>
      resolveMultiDeviceTargets(bindings, { A_ID: 'emu-1', B_ID: '  ' }),
    ).toThrow(/phone2/);
  });

  it('拒绝同一平台同一物理 ID 的重复绑定', () => {
    const bindings = parseMultiDeviceBindings(
      'phone1:android:A_ID,phone2:android:B_ID',
    );
    expect(() =>
      resolveMultiDeviceTargets(bindings, { A_ID: 'emu-1', B_ID: 'emu-1' }),
    ).toThrow(/phone1 与 phone2 均指向 android 设备 emu-1/);
  });

  it('不同平台可以使用相同 ID 字符串', () => {
    const bindings = parseMultiDeviceBindings(
      'phone1:android:A_ID,phone2:harmony:B_ID',
    );
    expect(
      resolveMultiDeviceTargets(bindings, { A_ID: 'same', B_ID: 'same' }),
    ).toHaveLength(2);
  });
});

/**
 * 多媒体生成演示
 * 
 * 演示AI如何调用多媒体生成工具
 */

import {
  generate_image,
  generate_video,
  generate_3d_model,
  get_generation_status,
  download_generated_media,
} from './media-generation-tools.js';
import { getMediaGenerationCore } from './media-generation-core.js';

console.log('='.repeat(70));
console.log('多媒体生成系统 - AI工具调用演示');
console.log('='.repeat(70));

async function main() {
  // 启动核心
  const core = getMediaGenerationCore();
  core.start();

  // 监听事件
  core.on('task:created', (task) => {
    console.log(`\n[事件] 任务创建: ${task.id}, 类型: ${task.type}`);
  });

  core.on('task:started', (task) => {
    console.log(`[事件] 任务开始: ${task.id}`);
  });

  core.on('task:progress', (task) => {
    console.log(`[事件] 任务进度: ${task.id}, ${task.progress.toFixed(1)}%`);
  });

  core.on('task:completed', (task) => {
    console.log(`[事件] 任务完成: ${task.id}`);
    console.log(`       结果:`, task.result);
  });

  core.on('task:failed', (task) => {
    console.log(`[事件] 任务失败: ${task.id}, 错误: ${task.error}`);
  });

  // ═══════════════════════════════════════════════════════════
  // 演示1: 生成图像
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[演示1] AI生成图像');
  console.log('-'.repeat(50));

  const imageResult = await generate_image({
    prompt: '一只可爱的橘猫，坐在窗台上，阳光照射，高清摄影风格',
    width: 1024,
    height: 1024,
    style: 'photorealistic',
  });

  console.log('结果:', imageResult.success ? '✅ 成功' : '❌ 失败');
  console.log('任务ID:', imageResult.taskId);
  console.log('预计时间:', imageResult.estimatedTime, '秒');

  // ═══════════════════════════════════════════════════════════
  // 演示2: 生成视频（文生视频）
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[演示2] AI生成视频（文生视频）');
  console.log('-'.repeat(50));

  const videoResult = await generate_video({
    prompt: '海浪拍打沙滩，日落时分，金色阳光，4K画质',
    duration: 5,
    fps: 24,
    resolution: '1080p',
  });

  console.log('结果:', videoResult.success ? '✅ 成功' : '❌ 失败');
  console.log('任务ID:', videoResult.taskId);

  // ═══════════════════════════════════════════════════════════
  // 演示3: 生成3D模型（文生3D）
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[演示3] AI生成3D模型（文生3D - Tripo3D）');
  console.log('-'.repeat(50));

  const model3DResult = await generate_3d_model({
    prompt: '一个科幻风格的机器人，站立姿势，细节丰富',
    style: 'pbr',
    texture: true,
  });

  console.log('结果:', model3DResult.success ? '✅ 成功' : '❌ 失败');
  console.log('任务ID:', model3DResult.taskId);
  console.log('预计时间:', model3DResult.estimatedTime, '秒');

  // ═══════════════════════════════════════════════════════════
  // 演示4: 生成3D模型（图生3D）
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[演示4] AI生成3D模型（图生3D - Tripo3D）');
  console.log('-'.repeat(50));

  const model3DFromImage = await generate_3d_model({
    imageUrl: 'https://example.com/character.jpg',
    style: 'pbr',
    texture: true,
  });

  console.log('结果:', model3DFromImage.success ? '✅ 成功' : '❌ 失败');
  console.log('任务ID:', model3DFromImage.taskId);

  // ═══════════════════════════════════════════════════════════
  // 演示5: 查询任务状态
  // ═══════════════════════════════════════════════════════════
  
  if (model3DResult.taskId) {
    console.log('\n[演示5] 查询3D生成任务状态');
    console.log('-'.repeat(50));

    const statusResult = await get_generation_status({
      taskId: model3DResult.taskId,
    });

    console.log('结果:', statusResult.success ? '✅ 成功' : '❌ 失败');
    if (statusResult.status) {
      console.log('状态:', statusResult.status.status);
      console.log('进度:', statusResult.status.progress + '%');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 演示6: 获取系统统计
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[演示6] 系统统计');
  console.log('-'.repeat(50));

  const stats = core.getStats();
  console.log('总任务:', stats.total);
  console.log('待处理:', stats.pending);
  console.log('处理中:', stats.processing);
  console.log('已完成:', stats.completed);
  console.log('失败:', stats.failed);

  // ═══════════════════════════════════════════════════════════
  // 完成
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n' + '='.repeat(70));
  console.log('演示完成！');
  console.log('='.repeat(70));
  console.log('\nAI现在可以调用以下多媒体生成工具：');
  console.log('  1. generate_image - 生成图像');
  console.log('  2. generate_video - 生成视频');
  console.log('  3. generate_3d_model - 生成3D模型（Tripo3D）');
  console.log('  4. get_generation_status - 查询状态');
  console.log('  5. download_generated_media - 下载媒体');
  console.log('  6. batch_generate - 批量生成');

  // 停止核心
  core.stop();
}

// 运行
main().catch(console.error);

export { main };

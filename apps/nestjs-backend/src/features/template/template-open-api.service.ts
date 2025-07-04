import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { generateTemplateCategoryId, generateTemplateId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';

import {
  UploadType,
  type ICreateTemplateCategoryRo,
  type ICreateTemplateRo,
  type IUpdateTemplateCategoryRo,
  type IUpdateTemplateRo,
} from '@teable/openapi';
import { isNumber } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import type { IClsStore } from '../../types/cls';
import { AttachmentsStorageService } from '../attachments/attachments-storage.service';
import StorageAdapter from '../attachments/plugins/adapter';
import { BaseService } from '../base/base.service';

@Injectable()
export class TemplateOpenApiService {
  private logger = new Logger(TemplateOpenApiService.name);
  constructor(
    private readonly prismaService: PrismaService,
    private readonly baseService: BaseService,
    private readonly cls: ClsService<IClsStore>,
    private readonly attachmentsStorageService: AttachmentsStorageService,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

  async createTemplate(createTemplateRo: ICreateTemplateRo) {
    const userId = this.cls.get('user.id');
    const templateId = generateTemplateId();
    const order = await this.prismaService.template.aggregate({
      _max: {
        order: true,
      },
    });
    const finalOrder = isNumber(order._max.order) ? order._max.order + 1 : 1;
    return await this.prismaService.template.create({
      data: {
        id: templateId,
        ...createTemplateRo,
        createdBy: userId,
        order: finalOrder,
      },
    });
  }

  async getAllTemplateList() {
    const res = await this.prismaService.template.findMany({
      where: {},
      orderBy: {
        order: 'asc',
      },
    });

    const previewUrlMap: Record<string, string> = {};
    for (const item of res) {
      const cover = item.cover ? JSON.parse(item.cover) : undefined;
      if (!cover) {
        continue;
      }

      const { path, token } = cover;
      const previewUrl = await this.attachmentsStorageService.getPreviewUrlByPath(
        StorageAdapter.getBucket(UploadType.Template),
        path,
        token
      );
      previewUrlMap[item.id] = previewUrl;
    }

    return res.map((item) => ({
      ...item,
      cover: item.cover
        ? {
            ...JSON.parse(item.cover),
            presignedUrl: previewUrlMap[item.id],
          }
        : undefined,
      snapshot: item.snapshot ? JSON.parse(item.snapshot) : undefined,
    }));
  }

  async getPublishedTemplateList() {
    const res = await this.prismaService.template.findMany({
      where: {
        isPublished: true,
      },
      orderBy: {
        order: 'asc',
      },
    });

    const previewUrlMap: Record<string, string> = {};
    for (const item of res) {
      const cover = item.cover ? JSON.parse(item.cover) : undefined;
      if (!cover) {
        continue;
      }

      const { bucket, path, token } = cover;
      const previewUrl = await this.attachmentsStorageService.getPreviewUrlByPath(
        bucket,
        path,
        token
      );
      previewUrlMap[item.id] = previewUrl;
    }

    return res.map((item) => ({
      ...item,
      cover: item.cover
        ? {
            ...JSON.parse(item.cover),
            presignedUrl: previewUrlMap[item.id],
          }
        : undefined,
      snapshot: item.snapshot ? JSON.parse(item.snapshot) : undefined,
    }));
  }

  async deleteTemplate(templateId: string) {
    return await this.prismaService.template.delete({
      where: {
        id: templateId,
      },
    });
  }

  async updateTemplate(templateId: string, updateTemplateRo: IUpdateTemplateRo) {
    const newCover = updateTemplateRo?.cover
      ? JSON.stringify(updateTemplateRo.cover)
      : updateTemplateRo?.cover;

    const originalTemplate = await this.prismaService.template.findUniqueOrThrow({
      where: { id: templateId },
    });

    if (updateTemplateRo.isPublished && !originalTemplate.snapshot) {
      throw new BadGatewayException(
        'This template could not be published, causing the lacking of snapshot'
      );
    }

    await this.prismaService.template.update({
      where: { id: templateId },
      data: {
        ...updateTemplateRo,
        cover: newCover as string | null | undefined,
      },
    });
  }

  async createTemplateSnapshot(templateId: string) {
    const prisma = this.prismaService.txClient();
    const templateRaw = await prisma.template.findUniqueOrThrow({
      where: { id: templateId },
      select: {
        baseId: true,
        name: true,
        snapshot: true,
      },
    });

    if (!templateRaw.baseId) {
      throw new Error('source template not found');
    }

    const templateSpaceId = await prisma.space.findFirstOrThrow({
      where: {
        isTemplate: true,
      },
      select: {
        id: true,
      },
    });

    return await this.prismaService.$tx(
      async (prisma) => {
        const res = await this.baseService.duplicateBaseForTemplate({
          fromBaseId: templateRaw.baseId!,
          spaceId: templateSpaceId.id,
          withRecords: true,
          name: templateRaw?.name || 'template snapshot',
        });

        if (templateRaw.snapshot) {
          // delete previous base
          const snapshot = JSON.parse(templateRaw.snapshot);
          await prisma.base.update({
            where: { id: snapshot.baseId },
            data: {
              deletedTime: new Date().toISOString(),
            },
          });
        }

        return await prisma.template.update({
          where: { id: templateId },
          data: {
            snapshot: JSON.stringify({
              baseId: res.id,
              snapshotTime: new Date().toISOString(),
              spaceId: res.spaceId,
              name: res.name,
            }),
          },
        });
      },
      {
        timeout: this.thresholdConfig.bigTransactionTimeout,
      }
    );
  }

  async createTemplateCategory(createTemplateCategoryRo: ICreateTemplateCategoryRo) {
    const userId = this.cls.get('user.id');
    const categoryId = generateTemplateCategoryId();
    const maxOrder = await this.prismaService.templateCategory.aggregate({
      _max: {
        order: true,
      },
    });

    const finalOrder = isNumber(maxOrder._max.order) ? maxOrder._max.order + 1 : 1;

    return await this.prismaService.templateCategory.create({
      data: {
        id: categoryId,
        ...createTemplateCategoryRo,
        createdBy: userId,
        order: finalOrder,
      },
    });
  }

  async getTemplateCategoryList() {
    return await this.prismaService.templateCategory.findMany({
      orderBy: {
        order: 'asc',
      },
    });
  }

  async pinTopTemplate(templateId: string) {
    const result = await this.prismaService.template.aggregate({
      _min: {
        order: true,
      },
    });

    if (!isNumber(result._min.order)) {
      throw new BadGatewayException('No min order found');
    }

    await this.prismaService.template.update({
      where: { id: templateId },
      data: { order: result._min.order - 1 },
    });
  }

  async deleteTemplateCategory(categoryId: string) {
    await this.prismaService.templateCategory.delete({
      where: { id: categoryId },
    });
  }

  async updateTemplateCategory(
    categoryId: string,
    updateTemplateCategoryRo: IUpdateTemplateCategoryRo
  ) {
    await this.prismaService.templateCategory.update({
      where: { id: categoryId },
      data: { ...updateTemplateCategoryRo },
    });
  }

  async updateTemplateUsageCount(templateId: string) {
    await this.prismaService.template.update({
      where: { id: templateId },
      data: { usageCount: { increment: 1 } },
    });
  }
}

import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CaseService } from './case.service';
import { UserGuard } from '../shared/guards/user.guard';
import { User } from '../shared/decorator/user.decorator';
import { OpenCaseDto } from './dto/open-case.dto';
import { GetCasesDto } from './dto/get-cases.dto';
import { GetCasesCursorDto } from './dto/get-cases-cursor.dto';
import { CaseResponseDto } from './dto/case-response.dto';

@ApiTags('Cases')
@Controller('case')
export class CaseController {
  constructor(private readonly caseService: CaseService) {}

  @Get()
  @ApiOperation({ summary: 'Get all cases with pagination and sorting' })
  @ApiResponse({
    status: 200,
    description: 'Returns paginated list of cases',
  })
  async findAll(@Query() getCasesDto: GetCasesDto) {
    return this.caseService.findAll(getCasesDto);
  }

  @Get('cursor')
  @ApiOperation({ summary: 'Get all cases with cursor-based pagination' })
  @ApiResponse({
    status: 200,
    description: 'Returns cursor-paginated list of cases',
  })
  async findAllCursor(@Query() getCasesCursorDto: GetCasesCursorDto) {
    return this.caseService.findAllCursor(getCasesCursorDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get case by ID with detailed items' })
  @ApiResponse({
    status: 200,
    description: 'Returns case details with items and prizes',
    type: CaseResponseDto,
  })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.caseService.findOne(id);
  }

  @Get(':id/cooldown')
  @UseGuards(UserGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({
    summary: 'Check free case cooldown timer for authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns cooldown status and remaining time',
  })
  async checkCooldown(
    @Param('id', ParseIntPipe) caseId: number,
    @User('id') userId: string,
  ) {
    return this.caseService.checkFreeCaseCooldown(caseId, userId);
  }

  @Post(':id/open')
  @UseGuards(UserGuard)
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Open a case and receive random prizes' })
  @ApiResponse({
    status: 201,
    description: 'Case(s) opened successfully, returns won prizes',
  })
  async openCase(
    @Param('id', ParseIntPipe) caseId: number,
    @Body() openCaseDto: OpenCaseDto,
    @User('id') userId: string,
  ) {
    return this.caseService.openCase(caseId, userId, openCaseDto.multiplier);
  }
}

package server

import (
	"errors"

	"github.com/gofiber/fiber/v2"
	"github.com/unkeyed/unkey/apps/agent/pkg/database"
	"github.com/unkeyed/unkey/apps/agent/pkg/entities"
	httpErrors "github.com/unkeyed/unkey/apps/agent/pkg/errors"
	"github.com/unkeyed/unkey/apps/agent/pkg/services/workspaces"
	"go.uber.org/zap"
)

type CreateWorkspaceRequest struct {
	Name     string `json:"name" validate:"required"`
	Slug     string `json:"slug" validate:"required"`
	TenantId string `json:"tenantId" validate:"required"`
}

type CreateWorkspaceResponse struct {
	Id string `json:"id"`
}

func (s *Server) createWorkspace(c *fiber.Ctx) error {
	ctx, span := s.tracer.Start(c.UserContext(), "server.getKey")
	defer span.End()
	req := CreateWorkspaceRequest{}

	err := c.BodyParser(&req)
	if err != nil {
		return httpErrors.NewHttpError(c, httpErrors.BAD_REQUEST, err.Error())
	}

	err = s.validator.Struct(req)
	if err != nil {
		return httpErrors.NewHttpError(c, httpErrors.BAD_REQUEST, err.Error())
	}

	err = s.authorizeStaticKey(ctx, c.Get("Authorization"))
	if err != nil {
		return httpErrors.NewHttpError(c, httpErrors.UNAUTHORIZED, err.Error())
	}

	s.logger.Info("req", zap.Any("req", req), zap.Any("ws", s.workspaceService))
	ws, err := s.workspaceService.CreateWorkspace(ctx, workspaces.CreateWorkspaceRequest{
		Name:     req.Name,
		Slug:     req.Slug,
		TenantId: req.TenantId,
		Plan:     entities.FreePlan,
	})
	if err != nil {
		if errors.Is(err, database.ErrNotUnique) {
			return httpErrors.NewHttpError(c, httpErrors.NOT_UNIQUE, err.Error())

		}
		return httpErrors.NewHttpError(c, httpErrors.INTERNAL_SERVER_ERROR, err.Error())
	}

	return c.JSON(CreateWorkspaceResponse{
		Id: ws.Id,
	})
}
